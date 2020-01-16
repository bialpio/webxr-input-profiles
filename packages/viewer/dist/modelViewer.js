import { Object3D, Quaternion, SphereGeometry, MeshBasicMaterial, Mesh, PerspectiveCamera, Scene, Color, WebGLRenderer, PMREMGenerator, UnsignedByteType } from './three/build/three.module.js';
import { OrbitControls } from './three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from './three/examples/jsm/loaders/RGBELoader.js';
import { VRButton } from './three/examples/jsm/webxr/VRButton.js';
import { GLTFLoader } from './three/examples/jsm/loaders/GLTFLoader.js';
import { Constants as Constants$1, fetchProfilesList, fetchProfile, MotionController } from './motion-controllers.module.js';
import './ajv/ajv.min.js';
import validateRegistryProfile from './registryTools/validateRegistryProfile.js';
import expandRegistryProfile from './assetTools/expandRegistryProfile.js';
import buildAssetProfile from './assetTools/buildAssetProfile.js';

let motionController;
let mockGamepad;
let controlsListElement;

function updateText() {
  if (motionController) {
    Object.values(motionController.components).forEach((component) => {
      const dataElement = document.getElementById(`${component.id}_data`);
      dataElement.innerHTML = JSON.stringify(component.data, null, 2);
    });
  }
}

function onButtonValueChange(event) {
  const { index } = event.target.dataset;
  mockGamepad.buttons[index].value = Number(event.target.value);
}

function onAxisValueChange(event) {
  const { index } = event.target.dataset;
  mockGamepad.axes[index] = Number(event.target.value);
}

function clear() {
  motionController = undefined;
  mockGamepad = undefined;

  if (!controlsListElement) {
    controlsListElement = document.getElementById('controlsList');
  }
  controlsListElement.innerHTML = '';
}

function addButtonControls(componentControlsElement, buttonIndex) {
  const buttonControlsElement = document.createElement('div');
  buttonControlsElement.setAttribute('class', 'componentControls');

  buttonControlsElement.innerHTML += `
  <label>buttonValue</label>
  <input id="buttons[${buttonIndex}].value" data-index="${buttonIndex}" type="range" min="0" max="1" step="0.01" value="0">
  `;

  componentControlsElement.appendChild(buttonControlsElement);

  document.getElementById(`buttons[${buttonIndex}].value`).addEventListener('input', onButtonValueChange);
}

function addAxisControls(componentControlsElement, axisName, axisIndex) {
  const axisControlsElement = document.createElement('div');
  axisControlsElement.setAttribute('class', 'componentControls');

  axisControlsElement.innerHTML += `
  <label>${axisName}<label>
  <input id="axes[${axisIndex}]" data-index="${axisIndex}"
          type="range" min="-1" max="1" step="0.01" value="0">
  `;

  componentControlsElement.appendChild(axisControlsElement);

  document.getElementById(`axes[${axisIndex}]`).addEventListener('input', onAxisValueChange);
}

function build(sourceMotionController) {
  clear();

  motionController = sourceMotionController;
  mockGamepad = motionController.xrInputSource.gamepad;

  Object.values(motionController.components).forEach((component) => {
    const componentControlsElement = document.createElement('li');
    componentControlsElement.setAttribute('class', 'component');
    controlsListElement.appendChild(componentControlsElement);

    const headingElement = document.createElement('h4');
    headingElement.innerText = `${component.id}`;
    componentControlsElement.appendChild(headingElement);

    if (component.gamepadIndices.button !== undefined) {
      addButtonControls(componentControlsElement, component.gamepadIndices.button);
    }

    if (component.gamepadIndices.xAxis !== undefined) {
      addAxisControls(componentControlsElement, 'xAxis', component.gamepadIndices.xAxis);
    }

    if (component.gamepadIndices.yAxis !== undefined) {
      addAxisControls(componentControlsElement, 'yAxis', component.gamepadIndices.yAxis);
    }

    const dataElement = document.createElement('pre');
    dataElement.id = `${component.id}_data`;
    componentControlsElement.appendChild(dataElement);
  });
}

var ManualControls = { clear, build, updateText };

let errorsSectionElement;
let errorsListElement;
class AssetError extends Error {
  constructor(...params) {
    super(...params);
    AssetError.log(this.message);
  }

  static initialize() {
    errorsListElement = document.getElementById('errors');
    errorsSectionElement = document.getElementById('errors');
  }

  static log(errorMessage) {
    const itemElement = document.createElement('li');
    itemElement.innerText = errorMessage;
    errorsListElement.appendChild(itemElement);
    errorsSectionElement.hidden = false;
  }

  static clearAll() {
    errorsListElement.innerHTML = '';
    errorsSectionElement.hidden = true;
  }
}

/* eslint-disable import/no-unresolved */

const gltfLoader = new GLTFLoader();

class ControllerModel extends Object3D {
  constructor() {
    super();
    this.xrInputSource = null;
    this.motionController = null;
    this.asset = null;
    this.rootNode = null;
    this.nodes = {};
    this.loaded = false;
    this.envMap = null;
  }

  set environmentMap(value) {
    if (this.envMap === value) {
      return;
    }

    this.envMap = value;
    /* eslint-disable no-param-reassign */
    this.traverse((child) => {
      if (child.isMesh) {
        child.material.envMap = this.envMap;
        child.material.needsUpdate = true;
      }
    });
    /* eslint-enable */
  }

  get environmentMap() {
    return this.envMap;
  }

  async initialize(motionController) {
    this.motionController = motionController;
    this.xrInputSource = this.motionController.xrInputSource;

    // Fetch the assets and generate threejs objects for it
    this.asset = await new Promise(((resolve, reject) => {
      gltfLoader.load(
        motionController.assetUrl,
        (loadedAsset) => { resolve(loadedAsset); },
        null,
        () => { reject(new AssetError(`Asset ${motionController.assetUrl} missing or malformed.`)); }
      );
    }));

    if (this.envMap) {
      /* eslint-disable no-param-reassign */
      this.asset.scene.traverse((child) => {
        if (child.isMesh) {
          child.material.envMap = this.envMap;
        }
      });
      /* eslint-enable */
    }

    this.rootNode = this.asset.scene;
    this.addTouchDots();
    this.findNodes();
    this.add(this.rootNode);
    this.loaded = true;
  }

  /**
   * Polls data from the XRInputSource and updates the model's components to match
   * the real world data
   */
  updateMatrixWorld(force) {
    super.updateMatrixWorld(force);

    if (!this.loaded) {
      return;
    }

    // Cause the MotionController to poll the Gamepad for data
    this.motionController.updateFromGamepad();

    // Update the 3D model to reflect the button, thumbstick, and touchpad state
    Object.values(this.motionController.components).forEach((component) => {
      // Update node data based on the visual responses' current states
      Object.values(component.visualResponses).forEach((visualResponse) => {
        const {
          valueNodeName, minNodeName, maxNodeName, value, valueNodeProperty
        } = visualResponse;
        const valueNode = this.nodes[valueNodeName];

        // Skip if the visual response node is not found. No error is needed,
        // because it will have been reported at load time.
        if (!valueNode) return;

        // Calculate the new properties based on the weight supplied
        if (valueNodeProperty === Constants$1.VisualResponseProperty.VISIBILITY) {
          valueNode.visible = value;
        } else if (valueNodeProperty === Constants$1.VisualResponseProperty.TRANSFORM) {
          const minNode = this.nodes[minNodeName];
          const maxNode = this.nodes[maxNodeName];
          Quaternion.slerp(
            minNode.quaternion,
            maxNode.quaternion,
            valueNode.quaternion,
            value
          );

          valueNode.position.lerpVectors(
            minNode.position,
            maxNode.position,
            value
          );
        }
      });
    });
  }

  /**
   * Walks the model's tree to find the nodes needed to animate the components and
   * saves them for use in the frame loop
   */
  findNodes() {
    this.nodes = {};

    // Loop through the components and find the nodes needed for each components' visual responses
    Object.values(this.motionController.components).forEach((component) => {
      const { touchPointNodeName, visualResponses } = component;
      if (touchPointNodeName) {
        this.nodes[touchPointNodeName] = this.rootNode.getObjectByName(touchPointNodeName);
      }

      // Loop through all the visual responses to be applied to this component
      Object.values(visualResponses).forEach((visualResponse) => {
        const {
          valueNodeName, minNodeName, maxNodeName, valueNodeProperty
        } = visualResponse;
        // If animating a transform, find the two nodes to be interpolated between.
        if (valueNodeProperty === Constants$1.VisualResponseProperty.TRANSFORM) {
          this.nodes[minNodeName] = this.rootNode.getObjectByName(minNodeName);
          this.nodes[maxNodeName] = this.rootNode.getObjectByName(maxNodeName);

          // If the extents cannot be found, skip this animation
          if (!this.nodes[minNodeName]) {
            AssetError.log(`Could not find ${minNodeName} in the model`);
            return;
          }
          if (!this.nodes[maxNodeName]) {
            AssetError.log(`Could not find ${maxNodeName} in the model`);
            return;
          }
        }

        // If the target node cannot be found, skip this animation
        this.nodes[valueNodeName] = this.rootNode.getObjectByName(valueNodeName);
        if (!this.nodes[valueNodeName]) {
          AssetError.log(`Could not find ${valueNodeName} in the model`);
        }
      });
    });
  }

  /**
   * Add touch dots to all touchpad components so the finger can be seen
   */
  addTouchDots() {
    Object.keys(this.motionController.components).forEach((componentId) => {
      const component = this.motionController.components[componentId];
      // Find the touchpads
      if (component.type === Constants$1.ComponentType.TOUCHPAD) {
        // Find the node to attach the touch dot.
        const touchPointRoot = this.rootNode.getObjectByName(component.touchPointNodeName, true);
        if (!touchPointRoot) {
          AssetError.log(`Could not find touch dot, ${component.touchPointNodeName}, in touchpad component ${componentId}`);
        } else {
          const sphereGeometry = new SphereGeometry(0.001);
          const material = new MeshBasicMaterial({ color: 0x0000FF });
          const sphere = new Mesh(sphereGeometry, material);
          touchPointRoot.add(sphere);
        }
      }
    });
  }
}

/* eslint-disable import/no-unresolved */

/**
 * Loads a profile from a set of local files
 */
class LocalProfile extends EventTarget {
  constructor() {
    super();

    this.localFilesListElement = document.getElementById('localFilesList');
    this.filesSelector = document.getElementById('localFilesSelector');
    this.filesSelector.addEventListener('change', () => {
      this.onFilesSelected();
    });

    this.clear();

    LocalProfile.buildSchemaValidator('registryTools/registrySchemas.json').then((registrySchemaValidator) => {
      this.registrySchemaValidator = registrySchemaValidator;
      LocalProfile.buildSchemaValidator('assetTools/assetSchemas.json').then((assetSchemaValidator) => {
        this.assetSchemaValidator = assetSchemaValidator;
        const duringPageLoad = true;
        this.onFilesSelected(duringPageLoad);
      });
    });
  }

  /**
   * Clears all local profile information
   */
  clear() {
    if (this.profile) {
      this.profile = null;
      this.profileId = null;
      this.assets = [];
      this.localFilesListElement.innerHTML = '';

      const changeEvent = new Event('localProfileChange');
      this.dispatchEvent(changeEvent);
    }
  }

  /**
   * Processes selected files and generates an asset profile
   * @param {boolean} duringPageLoad
   */
  async onFilesSelected(duringPageLoad) {
    this.clear();

    // Skip if initialzation is incomplete
    if (!this.assetSchemaValidator) {
      return;
    }

    // Examine the files selected to find the registry profile, asset overrides, and asset files
    const assets = [];
    let assetJsonFile;
    let registryJsonFile;

    const filesList = Array.from(this.filesSelector.files);
    filesList.forEach((file) => {
      if (file.name.endsWith('.glb')) {
        assets[file.name] = window.URL.createObjectURL(file);
      } else if (file.name === 'profile.json') {
        assetJsonFile = file;
      } else if (file.name.endsWith('.json')) {
        registryJsonFile = file;
      }

      // List the files found
      this.localFilesListElement.innerHTML += `
        <li>${file.name}</li>
      `;
    });

    if (!registryJsonFile) {
      AssetError.log('No registry profile selected');
      return;
    }

    await this.buildProfile(registryJsonFile, assetJsonFile, assets);
    this.assets = assets;

    // Change the selected profile to the one just loaded.  Do not do this on initial page load
    // because the selected files persists in firefox across refreshes, but the user may have
    // selected a different item from the dropdown
    if (!duringPageLoad) {
      window.localStorage.setItem('profileId', this.profileId);
    }

    // Notify that the local profile is ready for use
    const changeEvent = new Event('localprofilechange');
    this.dispatchEvent(changeEvent);
  }

  /**
   * Build a merged profile file from the registry profile and asset overrides
   * @param {*} registryJsonFile
   * @param {*} assetJsonFile
   */
  async buildProfile(registryJsonFile, assetJsonFile) {
    // Load the registry JSON and validate it against the schema
    const registryJson = await LocalProfile.loadLocalJson(registryJsonFile);
    const isRegistryJsonValid = this.registrySchemaValidator(registryJson);
    if (!isRegistryJsonValid) {
      throw new AssetError(JSON.stringify(this.registrySchemaValidator.errors, null, 2));
    }

    // Load the asset JSON and validate it against the schema.
    // If no asset JSON present, use the default definiton
    let assetJson;
    if (!assetJsonFile) {
      assetJson = { profileId: registryJson.profileId, overrides: {} };
    } else {
      assetJson = await LocalProfile.loadLocalJson(assetJsonFile);
      const isAssetJsonValid = this.assetSchemaValidator(assetJson);
      if (!isAssetJsonValid) {
        throw new AssetError(JSON.stringify(this.assetSchemaValidator.errors, null, 2));
      }
    }

    // Validate non-schema requirements and build a combined profile
    validateRegistryProfile(registryJson);
    const expandedRegistryProfile = expandRegistryProfile(registryJson);
    this.profile = buildAssetProfile(assetJson, expandedRegistryProfile);
    this.profileId = this.profile.profileId;
  }

  /**
   * Helper to load JSON from a local file
   * @param {File} jsonFile
   */
  static loadLocalJson(jsonFile) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const json = JSON.parse(reader.result);
        resolve(json);
      };

      reader.onerror = () => {
        const errorMessage = `Unable to load JSON from ${jsonFile.name}`;
        AssetError.log(errorMessage);
        reject(errorMessage);
      };

      reader.readAsText(jsonFile);
    });
  }

  /**
   * Helper to load the combined schema file and compile an AJV validator
   * @param {string} schemasPath
   */
  static async buildSchemaValidator(schemasPath) {
    const response = await fetch(schemasPath);
    if (!response.ok) {
      throw new AssetError(response.statusText);
    }

    // eslint-disable-next-line no-undef
    const ajv = new Ajv();
    const schemas = await response.json();
    schemas.dependencies.forEach((schema) => {
      ajv.addSchema(schema);
    });

    return ajv.compile(schemas.mainSchema);
  }
}

/* eslint-disable import/no-unresolved */

const profilesBasePath = './profiles';

/**
 * Loads profiles from the distribution folder next to the viewer's location
 */
class ProfileSelector extends EventTarget {
  constructor() {
    super();

    // Get the profile id selector and listen for changes
    this.profileIdSelectorElement = document.getElementById('profileIdSelector');
    this.profileIdSelectorElement.addEventListener('change', () => { this.onProfileIdChange(); });

    // Get the handedness selector and listen for changes
    this.handednessSelectorElement = document.getElementById('handednessSelector');
    this.handednessSelectorElement.addEventListener('change', () => { this.onHandednessChange(); });

    this.forceVRProfileElement = document.getElementById('forceVRProfile');

    this.localProfile = new LocalProfile();
    this.localProfile.addEventListener('localprofilechange', (event) => { this.onLocalProfileChange(event); });

    this.profilesList = null;
    this.populateProfileSelector();
  }

  /**
   * Resets all selected profile state
   */
  clearSelectedProfile() {
    AssetError.clearAll();
    this.profile = null;
    this.handedness = null;
  }

  /**
   * Retrieves the full list of available profiles and populates the dropdown
   */
  async populateProfileSelector() {
    this.clearSelectedProfile();
    this.handednessSelectorElement.innerHTML = '';

    // Load and clear local storage
    const storedProfileId = window.localStorage.getItem('profileId');
    window.localStorage.removeItem('profileId');

    // Load the list of profiles
    if (!this.profilesList) {
      try {
        this.profileIdSelectorElement.innerHTML = '<option value="loading">Loading...</option>';
        this.profilesList = await fetchProfilesList(profilesBasePath);
      } catch (error) {
        this.profileIdSelectorElement.innerHTML = 'Failed to load list';
        AssetError.log(error.message);
        throw error;
      }
    }

    // Add each profile to the dropdown
    this.profileIdSelectorElement.innerHTML = '';
    Object.keys(this.profilesList).forEach((profileId) => {
      this.profileIdSelectorElement.innerHTML += `
      <option value='${profileId}'>${profileId}</option>
      `;
    });

    // Add the local profile if it isn't already included
    if (this.localProfile.profileId
     && !Object.keys(this.profilesList).includes(this.localProfile.profileId)) {
      this.profileIdSelectorElement.innerHTML += `
      <option value='${this.localProfile.profileId}'>${this.localProfile.profileId}</option>
      `;
      this.profilesList[this.localProfile.profileId] = this.localProfile;
    }

    // Override the default selection if values were present in local storage
    if (storedProfileId) {
      this.profileIdSelectorElement.value = storedProfileId;
    }

    // Manually trigger selected profile to load
    this.onProfileIdChange();
  }

  /**
   * Handler for the profile id selection change
   */
  onProfileIdChange() {
    this.clearSelectedProfile();
    this.handednessSelectorElement.innerHTML = '';

    const profileId = this.profileIdSelectorElement.value;
    window.localStorage.setItem('profileId', profileId);

    if (profileId === this.localProfile.profileId) {
      this.profile = this.localProfile.profile;
      this.populateHandednessSelector();
    } else {
      // Attempt to load the profile
      this.profileIdSelectorElement.disabled = true;
      this.handednessSelectorElement.disabled = true;
      fetchProfile({ profiles: [profileId] }, profilesBasePath, false).then(({ profile }) => {
        this.profile = profile;
        this.populateHandednessSelector();
      })
        .catch((error) => {
          AssetError.log(error.message);
          throw error;
        })
        .finally(() => {
          this.profileIdSelectorElement.disabled = false;
          this.handednessSelectorElement.disabled = false;
        });
    }
  }

  /**
   * Populates the handedness dropdown with those supported by the selected profile
   */
  populateHandednessSelector() {
    // Load and clear the last selection for this profile id
    const storedHandedness = window.localStorage.getItem('handedness');
    window.localStorage.removeItem('handedness');

    // Populate handedness selector
    Object.keys(this.profile.layouts).forEach((handedness) => {
      this.handednessSelectorElement.innerHTML += `
        <option value='${handedness}'>${handedness}</option>
      `;
    });

    // Apply stored handedness if found
    if (storedHandedness && this.profile.layouts[storedHandedness]) {
      this.handednessSelectorElement.value = storedHandedness;
    }

    // Manually trigger selected handedness change
    this.onHandednessChange();
  }

  /**
   * Responds to changes in selected handedness.
   * Creates a new motion controller for the combination of profile and handedness, and fires an
   * event to signal the change
   */
  onHandednessChange() {
    AssetError.clearAll();
    this.handedness = this.handednessSelectorElement.value;
    window.localStorage.setItem('handedness', this.handedness);
    if (this.handedness) {
      this.dispatchEvent(new Event('selectionchange'));
    } else {
      this.dispatchEvent(new Event('selectionclear'));
    }
  }

  /**
   * Updates the profiles dropdown to ensure local profile is in the list
   */
  onLocalProfileChange() {
    this.populateProfileSelector();
  }

  /**
   * Updates the profiles dropdown to ensure local profile is in the list
   */
  get forceVRProfile() {
    return this.forceVRProfileElement.checked;
  }

  /**
   * Builds a MotionController either based on the supplied input source using the local profile
   * if it is the best match, otherwise uses the remote assets
   * @param {XRInputSource} xrInputSource
   */
  async createMotionController(xrInputSource) {
    let profile;
    let assetPath;

    // Check if local override should be used
    let useLocalProfile = false;
    if (this.localProfile.profileId) {
      xrInputSource.profiles.some((profileId) => {
        const matchFound = Object.keys(this.profilesList).includes(profileId);
        useLocalProfile = matchFound && (profileId === this.localProfile.profileId);
        return matchFound;
      });
    }

    // Get profile and asset path
    if (useLocalProfile) {
      ({ profile } = this.localProfile);
      const assetName = this.localProfile.profile.layouts[xrInputSource.handedness].assetPath;
      assetPath = this.localProfile.assets[assetName] || assetName;
    } else {
      ({ profile, assetPath } = await fetchProfile(xrInputSource, profilesBasePath));
    }

    // Build motion controller
    const motionController = new MotionController(
      xrInputSource,
      profile,
      assetPath
    );

    return motionController;
  }
}

const defaultBackground = 'georgentor';

class BackgroundSelector extends EventTarget {
  constructor() {
    super();

    this.backgroundSelectorElement = document.getElementById('backgroundSelector');
    this.backgroundSelectorElement.addEventListener('change', () => { this.onBackgroundChange(); });

    this.selectedBackground = window.localStorage.getItem('background') || defaultBackground;
    this.backgroundList = {};
    fetch('backgrounds/backgrounds.json')
      .then(response => response.json())
      .then((backgrounds) => {
        this.backgroundList = backgrounds;
        Object.keys(backgrounds).forEach((background) => {
          const option = document.createElement('option');
          option.value = background;
          option.innerText = background;
          if (this.selectedBackground === background) {
            option.selected = true;
          }
          this.backgroundSelectorElement.appendChild(option);
        });
        this.dispatchEvent(new Event('selectionchange'));
      });
  }

  onBackgroundChange() {
    this.selectedBackground = this.backgroundSelectorElement.value;
    window.localStorage.setItem('background', this.selectedBackground);
    this.dispatchEvent(new Event('selectionchange'));
  }

  get backgroundPath() {
    return this.backgroundList[this.selectedBackground];
  }
}

const Constants = {
  Handedness: Object.freeze({
    NONE: 'none',
    LEFT: 'left',
    RIGHT: 'right'
  }),

  ComponentState: Object.freeze({
    DEFAULT: 'default',
    TOUCHED: 'touched',
    PRESSED: 'pressed'
  }),

  ComponentProperty: Object.freeze({
    BUTTON: 'button',
    X_AXIS: 'xAxis',
    Y_AXIS: 'yAxis',
    STATE: 'state'
  }),

  ComponentType: Object.freeze({
    TRIGGER: 'trigger',
    SQUEEZE: 'squeeze',
    TOUCHPAD: 'touchpad',
    THUMBSTICK: 'thumbstick',
    BUTTON: 'button'
  }),

  ButtonTouchThreshold: 0.05,

  AxisTouchThreshold: 0.1,

  VisualResponseProperty: Object.freeze({
    TRANSFORM: 'transform',
    VISIBILITY: 'visibility'
  })
};

/**
 * A false gamepad to be used in tests
 */
class MockGamepad {
  /**
   * @param {Object} profileDescription - The profile description to parse to determine the length
   * of the button and axes arrays
   * @param {string} handedness - The gamepad's handedness
   */
  constructor(profileDescription, handedness) {
    if (!profileDescription) {
      throw new Error('No profileDescription supplied');
    }

    if (!handedness) {
      throw new Error('No handedness supplied');
    }

    this.id = profileDescription.profileId;

    // Loop through the profile description to determine how many elements to put in the buttons
    // and axes arrays
    let maxButtonIndex = 0;
    let maxAxisIndex = 0;
    const layout = profileDescription.layouts[handedness];
    this.mapping = layout.mapping;
    Object.values(layout.components).forEach(({ gamepadIndices }) => {
      const {
        [Constants.ComponentProperty.BUTTON]: buttonIndex,
        [Constants.ComponentProperty.X_AXIS]: xAxisIndex,
        [Constants.ComponentProperty.Y_AXIS]: yAxisIndex
      } = gamepadIndices;

      if (buttonIndex !== undefined && buttonIndex > maxButtonIndex) {
        maxButtonIndex = buttonIndex;
      }

      if (xAxisIndex !== undefined && (xAxisIndex > maxAxisIndex)) {
        maxAxisIndex = xAxisIndex;
      }

      if (yAxisIndex !== undefined && (yAxisIndex > maxAxisIndex)) {
        maxAxisIndex = yAxisIndex;
      }
    });

    // Fill the axes array
    this.axes = [];
    while (this.axes.length <= maxAxisIndex) {
      this.axes.push(0);
    }

    // Fill the buttons array
    this.buttons = [];
    while (this.buttons.length <= maxButtonIndex) {
      this.buttons.push({
        value: 0,
        touched: false,
        pressed: false
      });
    }
  }
}

/**
 * A fake XRInputSource that can be used to initialize a MotionController
 */
class MockXRInputSource {
  /**
   * @param {Object} gamepad - The Gamepad object that provides the button and axis data
   * @param {string} handedness - The handedness to report
   */
  constructor(profiles, gamepad, handedness) {
    this.gamepad = gamepad;

    if (!handedness) {
      throw new Error('No handedness supplied');
    }

    this.handedness = handedness;
    this.profiles = Object.freeze(profiles);
  }
}

/* eslint-disable import/no-unresolved */

const three = {};
let canvasParentElement;

let profileSelector;
let backgroundSelector;
let mockControllerModel;
let isImmersive = false;

/**
 * Adds the event handlers for VR motion controllers to load the assets on connection
 * and remove them on disconnection
 * @param {number} index
 */
function initializeVRController(index) {
  const vrController = three.renderer.xr.getController(index);

  vrController.addEventListener('connected', async (event) => {
    const controllerModel = new ControllerModel();
    vrController.add(controllerModel);

    let xrInputSource = event.data;
    if (profileSelector.forceVRProfile) {
      xrInputSource = new MockXRInputSource(
        [profileSelector.profile.profileId], event.data.gamepad, event.data.handedness
      );
    }

    const motionController = await profileSelector.createMotionController(xrInputSource);
    await controllerModel.initialize(motionController);

    if (three.environmentMap) {
      controllerModel.environmentMap = three.environmentMap;
    }
  });

  vrController.addEventListener('disconnected', () => {
    vrController.remove(vrController.children[0]);
  });

  three.scene.add(vrController);
}

/**
 * The three.js render loop (used instead of requestAnimationFrame to support XR)
 */
function render() {
  if (mockControllerModel) {
    if (isImmersive) {
      three.scene.remove(mockControllerModel);
    } else {
      three.scene.add(mockControllerModel);
      ManualControls.updateText();
    }
  }

  three.cameraControls.update();

  three.renderer.render(three.scene, three.camera);
}

/**
 * @description Event handler for window resizing.
 */
function onResize() {
  const width = canvasParentElement.clientWidth;
  const height = canvasParentElement.clientHeight;
  three.camera.aspectRatio = width / height;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(width, height);
  three.cameraControls.update();
}

/**
 * Initializes the three.js resources needed for this page
 */
function initializeThree() {
  canvasParentElement = document.getElementById('modelViewer');
  const width = canvasParentElement.clientWidth;
  const height = canvasParentElement.clientHeight;

  // Set up the THREE.js infrastructure
  three.camera = new PerspectiveCamera(75, width / height, 0.01, 1000);
  three.camera.position.y = 0.5;
  three.scene = new Scene();
  three.scene.background = new Color(0x00aa44);
  three.renderer = new WebGLRenderer({ antialias: true });
  three.renderer.setSize(width, height);
  three.renderer.gammaOutput = true;

  // Set up the controls for moving the scene around
  three.cameraControls = new OrbitControls(three.camera, three.renderer.domElement);
  three.cameraControls.enableDamping = true;
  three.cameraControls.minDistance = 0.05;
  three.cameraControls.maxDistance = 0.3;
  three.cameraControls.enablePan = false;
  three.cameraControls.update();

  // Add VR
  canvasParentElement.appendChild(VRButton.createButton(three.renderer));
  three.renderer.xr.enabled = true;
  three.renderer.xr.addEventListener('sessionstart', () => { isImmersive = true; });
  three.renderer.xr.addEventListener('sessionend', () => { isImmersive = false; });
  initializeVRController(0);
  initializeVRController(1);

  // Add the THREE.js canvas to the page
  canvasParentElement.appendChild(three.renderer.domElement);
  window.addEventListener('resize', onResize, false);

  // Start pumping frames
  three.renderer.setAnimationLoop(render);
}

function onSelectionClear() {
  ManualControls.clear();
  if (mockControllerModel) {
    three.scene.remove(mockControllerModel);
    mockControllerModel = null;
  }
}

async function onSelectionChange() {
  onSelectionClear();
  const mockGamepad = new MockGamepad(profileSelector.profile, profileSelector.handedness);
  const mockXRInputSource = new MockXRInputSource(
    [profileSelector.profile.profileId], mockGamepad, profileSelector.handedness
  );
  mockControllerModel = new ControllerModel(mockXRInputSource);
  three.scene.add(mockControllerModel);

  const motionController = await profileSelector.createMotionController(mockXRInputSource);
  ManualControls.build(motionController);
  await mockControllerModel.initialize(motionController);

  if (three.environmentMap) {
    mockControllerModel.environmentMap = three.environmentMap;
  }
}

async function onBackgroundChange() {
  const pmremGenerator = new PMREMGenerator(three.renderer);
  pmremGenerator.compileEquirectangularShader();

  await new Promise((resolve) => {
    const rgbeLoader = new RGBELoader();
    rgbeLoader.setDataType(UnsignedByteType);
    rgbeLoader.setPath('backgrounds/');
    rgbeLoader.load(backgroundSelector.backgroundPath, (texture) => {
      three.environmentMap = pmremGenerator.fromEquirectangular(texture).texture;
      three.scene.background = three.environmentMap;

      if (mockControllerModel) {
        mockControllerModel.environmentMap = three.environmentMap;
      }

      pmremGenerator.dispose();
      resolve(three.environmentMap);
    });
  });
}

/**
 * Page load handler for initialzing things that depend on the DOM to be ready
 */
function onLoad() {
  AssetError.initialize();
  profileSelector = new ProfileSelector();
  initializeThree();

  profileSelector.addEventListener('selectionclear', onSelectionClear);
  profileSelector.addEventListener('selectionchange', onSelectionChange);

  backgroundSelector = new BackgroundSelector();
  backgroundSelector.addEventListener('selectionchange', onBackgroundChange);
}
window.addEventListener('load', onLoad);
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibW9kZWxWaWV3ZXIuanMiLCJzb3VyY2VzIjpbIi4uL3NyYy9tYW51YWxDb250cm9scy5qcyIsIi4uL3NyYy9hc3NldEVycm9yLmpzIiwiLi4vc3JjL2NvbnRyb2xsZXJNb2RlbC5qcyIsIi4uL3NyYy9sb2NhbFByb2ZpbGUuanMiLCIuLi9zcmMvcHJvZmlsZVNlbGVjdG9yLmpzIiwiLi4vc3JjL2JhY2tncm91bmRTZWxlY3Rvci5qcyIsIi4uLy4uL21vdGlvbi1jb250cm9sbGVycy9zcmMvY29uc3RhbnRzLmpzIiwiLi4vc3JjL21vY2tzL21vY2tHYW1lcGFkLmpzIiwiLi4vc3JjL21vY2tzL21vY2tYUklucHV0U291cmNlLmpzIiwiLi4vc3JjL21vZGVsVmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbImxldCBtb3Rpb25Db250cm9sbGVyO1xubGV0IG1vY2tHYW1lcGFkO1xubGV0IGNvbnRyb2xzTGlzdEVsZW1lbnQ7XG5cbmZ1bmN0aW9uIHVwZGF0ZVRleHQoKSB7XG4gIGlmIChtb3Rpb25Db250cm9sbGVyKSB7XG4gICAgT2JqZWN0LnZhbHVlcyhtb3Rpb25Db250cm9sbGVyLmNvbXBvbmVudHMpLmZvckVhY2goKGNvbXBvbmVudCkgPT4ge1xuICAgICAgY29uc3QgZGF0YUVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChgJHtjb21wb25lbnQuaWR9X2RhdGFgKTtcbiAgICAgIGRhdGFFbGVtZW50LmlubmVySFRNTCA9IEpTT04uc3RyaW5naWZ5KGNvbXBvbmVudC5kYXRhLCBudWxsLCAyKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiBvbkJ1dHRvblZhbHVlQ2hhbmdlKGV2ZW50KSB7XG4gIGNvbnN0IHsgaW5kZXggfSA9IGV2ZW50LnRhcmdldC5kYXRhc2V0O1xuICBtb2NrR2FtZXBhZC5idXR0b25zW2luZGV4XS52YWx1ZSA9IE51bWJlcihldmVudC50YXJnZXQudmFsdWUpO1xufVxuXG5mdW5jdGlvbiBvbkF4aXNWYWx1ZUNoYW5nZShldmVudCkge1xuICBjb25zdCB7IGluZGV4IH0gPSBldmVudC50YXJnZXQuZGF0YXNldDtcbiAgbW9ja0dhbWVwYWQuYXhlc1tpbmRleF0gPSBOdW1iZXIoZXZlbnQudGFyZ2V0LnZhbHVlKTtcbn1cblxuZnVuY3Rpb24gY2xlYXIoKSB7XG4gIG1vdGlvbkNvbnRyb2xsZXIgPSB1bmRlZmluZWQ7XG4gIG1vY2tHYW1lcGFkID0gdW5kZWZpbmVkO1xuXG4gIGlmICghY29udHJvbHNMaXN0RWxlbWVudCkge1xuICAgIGNvbnRyb2xzTGlzdEVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY29udHJvbHNMaXN0Jyk7XG4gIH1cbiAgY29udHJvbHNMaXN0RWxlbWVudC5pbm5lckhUTUwgPSAnJztcbn1cblxuZnVuY3Rpb24gYWRkQnV0dG9uQ29udHJvbHMoY29tcG9uZW50Q29udHJvbHNFbGVtZW50LCBidXR0b25JbmRleCkge1xuICBjb25zdCBidXR0b25Db250cm9sc0VsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgYnV0dG9uQ29udHJvbHNFbGVtZW50LnNldEF0dHJpYnV0ZSgnY2xhc3MnLCAnY29tcG9uZW50Q29udHJvbHMnKTtcblxuICBidXR0b25Db250cm9sc0VsZW1lbnQuaW5uZXJIVE1MICs9IGBcbiAgPGxhYmVsPmJ1dHRvblZhbHVlPC9sYWJlbD5cbiAgPGlucHV0IGlkPVwiYnV0dG9uc1ske2J1dHRvbkluZGV4fV0udmFsdWVcIiBkYXRhLWluZGV4PVwiJHtidXR0b25JbmRleH1cIiB0eXBlPVwicmFuZ2VcIiBtaW49XCIwXCIgbWF4PVwiMVwiIHN0ZXA9XCIwLjAxXCIgdmFsdWU9XCIwXCI+XG4gIGA7XG5cbiAgY29tcG9uZW50Q29udHJvbHNFbGVtZW50LmFwcGVuZENoaWxkKGJ1dHRvbkNvbnRyb2xzRWxlbWVudCk7XG5cbiAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoYGJ1dHRvbnNbJHtidXR0b25JbmRleH1dLnZhbHVlYCkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCBvbkJ1dHRvblZhbHVlQ2hhbmdlKTtcbn1cblxuZnVuY3Rpb24gYWRkQXhpc0NvbnRyb2xzKGNvbXBvbmVudENvbnRyb2xzRWxlbWVudCwgYXhpc05hbWUsIGF4aXNJbmRleCkge1xuICBjb25zdCBheGlzQ29udHJvbHNFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gIGF4aXNDb250cm9sc0VsZW1lbnQuc2V0QXR0cmlidXRlKCdjbGFzcycsICdjb21wb25lbnRDb250cm9scycpO1xuXG4gIGF4aXNDb250cm9sc0VsZW1lbnQuaW5uZXJIVE1MICs9IGBcbiAgPGxhYmVsPiR7YXhpc05hbWV9PGxhYmVsPlxuICA8aW5wdXQgaWQ9XCJheGVzWyR7YXhpc0luZGV4fV1cIiBkYXRhLWluZGV4PVwiJHtheGlzSW5kZXh9XCJcbiAgICAgICAgICB0eXBlPVwicmFuZ2VcIiBtaW49XCItMVwiIG1heD1cIjFcIiBzdGVwPVwiMC4wMVwiIHZhbHVlPVwiMFwiPlxuICBgO1xuXG4gIGNvbXBvbmVudENvbnRyb2xzRWxlbWVudC5hcHBlbmRDaGlsZChheGlzQ29udHJvbHNFbGVtZW50KTtcblxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChgYXhlc1ske2F4aXNJbmRleH1dYCkuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCBvbkF4aXNWYWx1ZUNoYW5nZSk7XG59XG5cbmZ1bmN0aW9uIGJ1aWxkKHNvdXJjZU1vdGlvbkNvbnRyb2xsZXIpIHtcbiAgY2xlYXIoKTtcblxuICBtb3Rpb25Db250cm9sbGVyID0gc291cmNlTW90aW9uQ29udHJvbGxlcjtcbiAgbW9ja0dhbWVwYWQgPSBtb3Rpb25Db250cm9sbGVyLnhySW5wdXRTb3VyY2UuZ2FtZXBhZDtcblxuICBPYmplY3QudmFsdWVzKG1vdGlvbkNvbnRyb2xsZXIuY29tcG9uZW50cykuZm9yRWFjaCgoY29tcG9uZW50KSA9PiB7XG4gICAgY29uc3QgY29tcG9uZW50Q29udHJvbHNFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbGknKTtcbiAgICBjb21wb25lbnRDb250cm9sc0VsZW1lbnQuc2V0QXR0cmlidXRlKCdjbGFzcycsICdjb21wb25lbnQnKTtcbiAgICBjb250cm9sc0xpc3RFbGVtZW50LmFwcGVuZENoaWxkKGNvbXBvbmVudENvbnRyb2xzRWxlbWVudCk7XG5cbiAgICBjb25zdCBoZWFkaW5nRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2g0Jyk7XG4gICAgaGVhZGluZ0VsZW1lbnQuaW5uZXJUZXh0ID0gYCR7Y29tcG9uZW50LmlkfWA7XG4gICAgY29tcG9uZW50Q29udHJvbHNFbGVtZW50LmFwcGVuZENoaWxkKGhlYWRpbmdFbGVtZW50KTtcblxuICAgIGlmIChjb21wb25lbnQuZ2FtZXBhZEluZGljZXMuYnV0dG9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGFkZEJ1dHRvbkNvbnRyb2xzKGNvbXBvbmVudENvbnRyb2xzRWxlbWVudCwgY29tcG9uZW50LmdhbWVwYWRJbmRpY2VzLmJ1dHRvbik7XG4gICAgfVxuXG4gICAgaWYgKGNvbXBvbmVudC5nYW1lcGFkSW5kaWNlcy54QXhpcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBhZGRBeGlzQ29udHJvbHMoY29tcG9uZW50Q29udHJvbHNFbGVtZW50LCAneEF4aXMnLCBjb21wb25lbnQuZ2FtZXBhZEluZGljZXMueEF4aXMpO1xuICAgIH1cblxuICAgIGlmIChjb21wb25lbnQuZ2FtZXBhZEluZGljZXMueUF4aXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgYWRkQXhpc0NvbnRyb2xzKGNvbXBvbmVudENvbnRyb2xzRWxlbWVudCwgJ3lBeGlzJywgY29tcG9uZW50LmdhbWVwYWRJbmRpY2VzLnlBeGlzKTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ByZScpO1xuICAgIGRhdGFFbGVtZW50LmlkID0gYCR7Y29tcG9uZW50LmlkfV9kYXRhYDtcbiAgICBjb21wb25lbnRDb250cm9sc0VsZW1lbnQuYXBwZW5kQ2hpbGQoZGF0YUVsZW1lbnQpO1xuICB9KTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgeyBjbGVhciwgYnVpbGQsIHVwZGF0ZVRleHQgfTtcbiIsImxldCBlcnJvcnNTZWN0aW9uRWxlbWVudDtcbmxldCBlcnJvcnNMaXN0RWxlbWVudDtcbmNsYXNzIEFzc2V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKC4uLnBhcmFtcykge1xuICAgIHN1cGVyKC4uLnBhcmFtcyk7XG4gICAgQXNzZXRFcnJvci5sb2codGhpcy5tZXNzYWdlKTtcbiAgfVxuXG4gIHN0YXRpYyBpbml0aWFsaXplKCkge1xuICAgIGVycm9yc0xpc3RFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Vycm9ycycpO1xuICAgIGVycm9yc1NlY3Rpb25FbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2Vycm9ycycpO1xuICB9XG5cbiAgc3RhdGljIGxvZyhlcnJvck1lc3NhZ2UpIHtcbiAgICBjb25zdCBpdGVtRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XG4gICAgaXRlbUVsZW1lbnQuaW5uZXJUZXh0ID0gZXJyb3JNZXNzYWdlO1xuICAgIGVycm9yc0xpc3RFbGVtZW50LmFwcGVuZENoaWxkKGl0ZW1FbGVtZW50KTtcbiAgICBlcnJvcnNTZWN0aW9uRWxlbWVudC5oaWRkZW4gPSBmYWxzZTtcbiAgfVxuXG4gIHN0YXRpYyBjbGVhckFsbCgpIHtcbiAgICBlcnJvcnNMaXN0RWxlbWVudC5pbm5lckhUTUwgPSAnJztcbiAgICBlcnJvcnNTZWN0aW9uRWxlbWVudC5oaWRkZW4gPSB0cnVlO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IEFzc2V0RXJyb3I7XG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBpbXBvcnQvbm8tdW5yZXNvbHZlZCAqL1xuaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAnLi90aHJlZS9idWlsZC90aHJlZS5tb2R1bGUuanMnO1xuaW1wb3J0IHsgR0xURkxvYWRlciB9IGZyb20gJy4vdGhyZWUvZXhhbXBsZXMvanNtL2xvYWRlcnMvR0xURkxvYWRlci5qcyc7XG5pbXBvcnQgeyBDb25zdGFudHMgfSBmcm9tICcuL21vdGlvbi1jb250cm9sbGVycy5tb2R1bGUuanMnO1xuLyogZXNsaW50LWVuYWJsZSAqL1xuXG5pbXBvcnQgQXNzZXRFcnJvciBmcm9tICcuL2Fzc2V0RXJyb3IuanMnO1xuXG5jb25zdCBnbHRmTG9hZGVyID0gbmV3IEdMVEZMb2FkZXIoKTtcblxuY2xhc3MgQ29udHJvbGxlck1vZGVsIGV4dGVuZHMgVEhSRUUuT2JqZWN0M0Qge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMueHJJbnB1dFNvdXJjZSA9IG51bGw7XG4gICAgdGhpcy5tb3Rpb25Db250cm9sbGVyID0gbnVsbDtcbiAgICB0aGlzLmFzc2V0ID0gbnVsbDtcbiAgICB0aGlzLnJvb3ROb2RlID0gbnVsbDtcbiAgICB0aGlzLm5vZGVzID0ge307XG4gICAgdGhpcy5sb2FkZWQgPSBmYWxzZTtcbiAgICB0aGlzLmVudk1hcCA9IG51bGw7XG4gIH1cblxuICBzZXQgZW52aXJvbm1lbnRNYXAodmFsdWUpIHtcbiAgICBpZiAodGhpcy5lbnZNYXAgPT09IHZhbHVlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5lbnZNYXAgPSB2YWx1ZTtcbiAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1wYXJhbS1yZWFzc2lnbiAqL1xuICAgIHRoaXMudHJhdmVyc2UoKGNoaWxkKSA9PiB7XG4gICAgICBpZiAoY2hpbGQuaXNNZXNoKSB7XG4gICAgICAgIGNoaWxkLm1hdGVyaWFsLmVudk1hcCA9IHRoaXMuZW52TWFwO1xuICAgICAgICBjaGlsZC5tYXRlcmlhbC5uZWVkc1VwZGF0ZSA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLyogZXNsaW50LWVuYWJsZSAqL1xuICB9XG5cbiAgZ2V0IGVudmlyb25tZW50TWFwKCkge1xuICAgIHJldHVybiB0aGlzLmVudk1hcDtcbiAgfVxuXG4gIGFzeW5jIGluaXRpYWxpemUobW90aW9uQ29udHJvbGxlcikge1xuICAgIHRoaXMubW90aW9uQ29udHJvbGxlciA9IG1vdGlvbkNvbnRyb2xsZXI7XG4gICAgdGhpcy54cklucHV0U291cmNlID0gdGhpcy5tb3Rpb25Db250cm9sbGVyLnhySW5wdXRTb3VyY2U7XG5cbiAgICAvLyBGZXRjaCB0aGUgYXNzZXRzIGFuZCBnZW5lcmF0ZSB0aHJlZWpzIG9iamVjdHMgZm9yIGl0XG4gICAgdGhpcy5hc3NldCA9IGF3YWl0IG5ldyBQcm9taXNlKCgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBnbHRmTG9hZGVyLmxvYWQoXG4gICAgICAgIG1vdGlvbkNvbnRyb2xsZXIuYXNzZXRVcmwsXG4gICAgICAgIChsb2FkZWRBc3NldCkgPT4geyByZXNvbHZlKGxvYWRlZEFzc2V0KTsgfSxcbiAgICAgICAgbnVsbCxcbiAgICAgICAgKCkgPT4geyByZWplY3QobmV3IEFzc2V0RXJyb3IoYEFzc2V0ICR7bW90aW9uQ29udHJvbGxlci5hc3NldFVybH0gbWlzc2luZyBvciBtYWxmb3JtZWQuYCkpOyB9XG4gICAgICApO1xuICAgIH0pKTtcblxuICAgIGlmICh0aGlzLmVudk1hcCkge1xuICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tcGFyYW0tcmVhc3NpZ24gKi9cbiAgICAgIHRoaXMuYXNzZXQuc2NlbmUudHJhdmVyc2UoKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZC5pc01lc2gpIHtcbiAgICAgICAgICBjaGlsZC5tYXRlcmlhbC5lbnZNYXAgPSB0aGlzLmVudk1hcDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICAvKiBlc2xpbnQtZW5hYmxlICovXG4gICAgfVxuXG4gICAgdGhpcy5yb290Tm9kZSA9IHRoaXMuYXNzZXQuc2NlbmU7XG4gICAgdGhpcy5hZGRUb3VjaERvdHMoKTtcbiAgICB0aGlzLmZpbmROb2RlcygpO1xuICAgIHRoaXMuYWRkKHRoaXMucm9vdE5vZGUpO1xuICAgIHRoaXMubG9hZGVkID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQb2xscyBkYXRhIGZyb20gdGhlIFhSSW5wdXRTb3VyY2UgYW5kIHVwZGF0ZXMgdGhlIG1vZGVsJ3MgY29tcG9uZW50cyB0byBtYXRjaFxuICAgKiB0aGUgcmVhbCB3b3JsZCBkYXRhXG4gICAqL1xuICB1cGRhdGVNYXRyaXhXb3JsZChmb3JjZSkge1xuICAgIHN1cGVyLnVwZGF0ZU1hdHJpeFdvcmxkKGZvcmNlKTtcblxuICAgIGlmICghdGhpcy5sb2FkZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDYXVzZSB0aGUgTW90aW9uQ29udHJvbGxlciB0byBwb2xsIHRoZSBHYW1lcGFkIGZvciBkYXRhXG4gICAgdGhpcy5tb3Rpb25Db250cm9sbGVyLnVwZGF0ZUZyb21HYW1lcGFkKCk7XG5cbiAgICAvLyBVcGRhdGUgdGhlIDNEIG1vZGVsIHRvIHJlZmxlY3QgdGhlIGJ1dHRvbiwgdGh1bWJzdGljaywgYW5kIHRvdWNocGFkIHN0YXRlXG4gICAgT2JqZWN0LnZhbHVlcyh0aGlzLm1vdGlvbkNvbnRyb2xsZXIuY29tcG9uZW50cykuZm9yRWFjaCgoY29tcG9uZW50KSA9PiB7XG4gICAgICAvLyBVcGRhdGUgbm9kZSBkYXRhIGJhc2VkIG9uIHRoZSB2aXN1YWwgcmVzcG9uc2VzJyBjdXJyZW50IHN0YXRlc1xuICAgICAgT2JqZWN0LnZhbHVlcyhjb21wb25lbnQudmlzdWFsUmVzcG9uc2VzKS5mb3JFYWNoKCh2aXN1YWxSZXNwb25zZSkgPT4ge1xuICAgICAgICBjb25zdCB7XG4gICAgICAgICAgdmFsdWVOb2RlTmFtZSwgbWluTm9kZU5hbWUsIG1heE5vZGVOYW1lLCB2YWx1ZSwgdmFsdWVOb2RlUHJvcGVydHlcbiAgICAgICAgfSA9IHZpc3VhbFJlc3BvbnNlO1xuICAgICAgICBjb25zdCB2YWx1ZU5vZGUgPSB0aGlzLm5vZGVzW3ZhbHVlTm9kZU5hbWVdO1xuXG4gICAgICAgIC8vIFNraXAgaWYgdGhlIHZpc3VhbCByZXNwb25zZSBub2RlIGlzIG5vdCBmb3VuZC4gTm8gZXJyb3IgaXMgbmVlZGVkLFxuICAgICAgICAvLyBiZWNhdXNlIGl0IHdpbGwgaGF2ZSBiZWVuIHJlcG9ydGVkIGF0IGxvYWQgdGltZS5cbiAgICAgICAgaWYgKCF2YWx1ZU5vZGUpIHJldHVybjtcblxuICAgICAgICAvLyBDYWxjdWxhdGUgdGhlIG5ldyBwcm9wZXJ0aWVzIGJhc2VkIG9uIHRoZSB3ZWlnaHQgc3VwcGxpZWRcbiAgICAgICAgaWYgKHZhbHVlTm9kZVByb3BlcnR5ID09PSBDb25zdGFudHMuVmlzdWFsUmVzcG9uc2VQcm9wZXJ0eS5WSVNJQklMSVRZKSB7XG4gICAgICAgICAgdmFsdWVOb2RlLnZpc2libGUgPSB2YWx1ZTtcbiAgICAgICAgfSBlbHNlIGlmICh2YWx1ZU5vZGVQcm9wZXJ0eSA9PT0gQ29uc3RhbnRzLlZpc3VhbFJlc3BvbnNlUHJvcGVydHkuVFJBTlNGT1JNKSB7XG4gICAgICAgICAgY29uc3QgbWluTm9kZSA9IHRoaXMubm9kZXNbbWluTm9kZU5hbWVdO1xuICAgICAgICAgIGNvbnN0IG1heE5vZGUgPSB0aGlzLm5vZGVzW21heE5vZGVOYW1lXTtcbiAgICAgICAgICBUSFJFRS5RdWF0ZXJuaW9uLnNsZXJwKFxuICAgICAgICAgICAgbWluTm9kZS5xdWF0ZXJuaW9uLFxuICAgICAgICAgICAgbWF4Tm9kZS5xdWF0ZXJuaW9uLFxuICAgICAgICAgICAgdmFsdWVOb2RlLnF1YXRlcm5pb24sXG4gICAgICAgICAgICB2YWx1ZVxuICAgICAgICAgICk7XG5cbiAgICAgICAgICB2YWx1ZU5vZGUucG9zaXRpb24ubGVycFZlY3RvcnMoXG4gICAgICAgICAgICBtaW5Ob2RlLnBvc2l0aW9uLFxuICAgICAgICAgICAgbWF4Tm9kZS5wb3NpdGlvbixcbiAgICAgICAgICAgIHZhbHVlXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogV2Fsa3MgdGhlIG1vZGVsJ3MgdHJlZSB0byBmaW5kIHRoZSBub2RlcyBuZWVkZWQgdG8gYW5pbWF0ZSB0aGUgY29tcG9uZW50cyBhbmRcbiAgICogc2F2ZXMgdGhlbSBmb3IgdXNlIGluIHRoZSBmcmFtZSBsb29wXG4gICAqL1xuICBmaW5kTm9kZXMoKSB7XG4gICAgdGhpcy5ub2RlcyA9IHt9O1xuXG4gICAgLy8gTG9vcCB0aHJvdWdoIHRoZSBjb21wb25lbnRzIGFuZCBmaW5kIHRoZSBub2RlcyBuZWVkZWQgZm9yIGVhY2ggY29tcG9uZW50cycgdmlzdWFsIHJlc3BvbnNlc1xuICAgIE9iamVjdC52YWx1ZXModGhpcy5tb3Rpb25Db250cm9sbGVyLmNvbXBvbmVudHMpLmZvckVhY2goKGNvbXBvbmVudCkgPT4ge1xuICAgICAgY29uc3QgeyB0b3VjaFBvaW50Tm9kZU5hbWUsIHZpc3VhbFJlc3BvbnNlcyB9ID0gY29tcG9uZW50O1xuICAgICAgaWYgKHRvdWNoUG9pbnROb2RlTmFtZSkge1xuICAgICAgICB0aGlzLm5vZGVzW3RvdWNoUG9pbnROb2RlTmFtZV0gPSB0aGlzLnJvb3ROb2RlLmdldE9iamVjdEJ5TmFtZSh0b3VjaFBvaW50Tm9kZU5hbWUpO1xuICAgICAgfVxuXG4gICAgICAvLyBMb29wIHRocm91Z2ggYWxsIHRoZSB2aXN1YWwgcmVzcG9uc2VzIHRvIGJlIGFwcGxpZWQgdG8gdGhpcyBjb21wb25lbnRcbiAgICAgIE9iamVjdC52YWx1ZXModmlzdWFsUmVzcG9uc2VzKS5mb3JFYWNoKCh2aXN1YWxSZXNwb25zZSkgPT4ge1xuICAgICAgICBjb25zdCB7XG4gICAgICAgICAgdmFsdWVOb2RlTmFtZSwgbWluTm9kZU5hbWUsIG1heE5vZGVOYW1lLCB2YWx1ZU5vZGVQcm9wZXJ0eVxuICAgICAgICB9ID0gdmlzdWFsUmVzcG9uc2U7XG4gICAgICAgIC8vIElmIGFuaW1hdGluZyBhIHRyYW5zZm9ybSwgZmluZCB0aGUgdHdvIG5vZGVzIHRvIGJlIGludGVycG9sYXRlZCBiZXR3ZWVuLlxuICAgICAgICBpZiAodmFsdWVOb2RlUHJvcGVydHkgPT09IENvbnN0YW50cy5WaXN1YWxSZXNwb25zZVByb3BlcnR5LlRSQU5TRk9STSkge1xuICAgICAgICAgIHRoaXMubm9kZXNbbWluTm9kZU5hbWVdID0gdGhpcy5yb290Tm9kZS5nZXRPYmplY3RCeU5hbWUobWluTm9kZU5hbWUpO1xuICAgICAgICAgIHRoaXMubm9kZXNbbWF4Tm9kZU5hbWVdID0gdGhpcy5yb290Tm9kZS5nZXRPYmplY3RCeU5hbWUobWF4Tm9kZU5hbWUpO1xuXG4gICAgICAgICAgLy8gSWYgdGhlIGV4dGVudHMgY2Fubm90IGJlIGZvdW5kLCBza2lwIHRoaXMgYW5pbWF0aW9uXG4gICAgICAgICAgaWYgKCF0aGlzLm5vZGVzW21pbk5vZGVOYW1lXSkge1xuICAgICAgICAgICAgQXNzZXRFcnJvci5sb2coYENvdWxkIG5vdCBmaW5kICR7bWluTm9kZU5hbWV9IGluIHRoZSBtb2RlbGApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIXRoaXMubm9kZXNbbWF4Tm9kZU5hbWVdKSB7XG4gICAgICAgICAgICBBc3NldEVycm9yLmxvZyhgQ291bGQgbm90IGZpbmQgJHttYXhOb2RlTmFtZX0gaW4gdGhlIG1vZGVsYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhlIHRhcmdldCBub2RlIGNhbm5vdCBiZSBmb3VuZCwgc2tpcCB0aGlzIGFuaW1hdGlvblxuICAgICAgICB0aGlzLm5vZGVzW3ZhbHVlTm9kZU5hbWVdID0gdGhpcy5yb290Tm9kZS5nZXRPYmplY3RCeU5hbWUodmFsdWVOb2RlTmFtZSk7XG4gICAgICAgIGlmICghdGhpcy5ub2Rlc1t2YWx1ZU5vZGVOYW1lXSkge1xuICAgICAgICAgIEFzc2V0RXJyb3IubG9nKGBDb3VsZCBub3QgZmluZCAke3ZhbHVlTm9kZU5hbWV9IGluIHRoZSBtb2RlbGApO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgdG91Y2ggZG90cyB0byBhbGwgdG91Y2hwYWQgY29tcG9uZW50cyBzbyB0aGUgZmluZ2VyIGNhbiBiZSBzZWVuXG4gICAqL1xuICBhZGRUb3VjaERvdHMoKSB7XG4gICAgT2JqZWN0LmtleXModGhpcy5tb3Rpb25Db250cm9sbGVyLmNvbXBvbmVudHMpLmZvckVhY2goKGNvbXBvbmVudElkKSA9PiB7XG4gICAgICBjb25zdCBjb21wb25lbnQgPSB0aGlzLm1vdGlvbkNvbnRyb2xsZXIuY29tcG9uZW50c1tjb21wb25lbnRJZF07XG4gICAgICAvLyBGaW5kIHRoZSB0b3VjaHBhZHNcbiAgICAgIGlmIChjb21wb25lbnQudHlwZSA9PT0gQ29uc3RhbnRzLkNvbXBvbmVudFR5cGUuVE9VQ0hQQUQpIHtcbiAgICAgICAgLy8gRmluZCB0aGUgbm9kZSB0byBhdHRhY2ggdGhlIHRvdWNoIGRvdC5cbiAgICAgICAgY29uc3QgdG91Y2hQb2ludFJvb3QgPSB0aGlzLnJvb3ROb2RlLmdldE9iamVjdEJ5TmFtZShjb21wb25lbnQudG91Y2hQb2ludE5vZGVOYW1lLCB0cnVlKTtcbiAgICAgICAgaWYgKCF0b3VjaFBvaW50Um9vdCkge1xuICAgICAgICAgIEFzc2V0RXJyb3IubG9nKGBDb3VsZCBub3QgZmluZCB0b3VjaCBkb3QsICR7Y29tcG9uZW50LnRvdWNoUG9pbnROb2RlTmFtZX0sIGluIHRvdWNocGFkIGNvbXBvbmVudCAke2NvbXBvbmVudElkfWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHNwaGVyZUdlb21ldHJ5ID0gbmV3IFRIUkVFLlNwaGVyZUdlb21ldHJ5KDAuMDAxKTtcbiAgICAgICAgICBjb25zdCBtYXRlcmlhbCA9IG5ldyBUSFJFRS5NZXNoQmFzaWNNYXRlcmlhbCh7IGNvbG9yOiAweDAwMDBGRiB9KTtcbiAgICAgICAgICBjb25zdCBzcGhlcmUgPSBuZXcgVEhSRUUuTWVzaChzcGhlcmVHZW9tZXRyeSwgbWF0ZXJpYWwpO1xuICAgICAgICAgIHRvdWNoUG9pbnRSb290LmFkZChzcGhlcmUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgQ29udHJvbGxlck1vZGVsO1xuIiwiLyogZXNsaW50LWRpc2FibGUgaW1wb3J0L25vLXVucmVzb2x2ZWQgKi9cbmltcG9ydCAnLi9hanYvYWp2Lm1pbi5qcyc7XG5pbXBvcnQgdmFsaWRhdGVSZWdpc3RyeVByb2ZpbGUgZnJvbSAnLi9yZWdpc3RyeVRvb2xzL3ZhbGlkYXRlUmVnaXN0cnlQcm9maWxlLmpzJztcbmltcG9ydCBleHBhbmRSZWdpc3RyeVByb2ZpbGUgZnJvbSAnLi9hc3NldFRvb2xzL2V4cGFuZFJlZ2lzdHJ5UHJvZmlsZS5qcyc7XG5pbXBvcnQgYnVpbGRBc3NldFByb2ZpbGUgZnJvbSAnLi9hc3NldFRvb2xzL2J1aWxkQXNzZXRQcm9maWxlLmpzJztcbi8qIGVzbGludC1lbmFibGUgKi9cblxuaW1wb3J0IEFzc2V0RXJyb3IgZnJvbSAnLi9hc3NldEVycm9yLmpzJztcblxuLyoqXG4gKiBMb2FkcyBhIHByb2ZpbGUgZnJvbSBhIHNldCBvZiBsb2NhbCBmaWxlc1xuICovXG5jbGFzcyBMb2NhbFByb2ZpbGUgZXh0ZW5kcyBFdmVudFRhcmdldCB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKCk7XG5cbiAgICB0aGlzLmxvY2FsRmlsZXNMaXN0RWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2NhbEZpbGVzTGlzdCcpO1xuICAgIHRoaXMuZmlsZXNTZWxlY3RvciA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdsb2NhbEZpbGVzU2VsZWN0b3InKTtcbiAgICB0aGlzLmZpbGVzU2VsZWN0b3IuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKCkgPT4ge1xuICAgICAgdGhpcy5vbkZpbGVzU2VsZWN0ZWQoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuY2xlYXIoKTtcblxuICAgIExvY2FsUHJvZmlsZS5idWlsZFNjaGVtYVZhbGlkYXRvcigncmVnaXN0cnlUb29scy9yZWdpc3RyeVNjaGVtYXMuanNvbicpLnRoZW4oKHJlZ2lzdHJ5U2NoZW1hVmFsaWRhdG9yKSA9PiB7XG4gICAgICB0aGlzLnJlZ2lzdHJ5U2NoZW1hVmFsaWRhdG9yID0gcmVnaXN0cnlTY2hlbWFWYWxpZGF0b3I7XG4gICAgICBMb2NhbFByb2ZpbGUuYnVpbGRTY2hlbWFWYWxpZGF0b3IoJ2Fzc2V0VG9vbHMvYXNzZXRTY2hlbWFzLmpzb24nKS50aGVuKChhc3NldFNjaGVtYVZhbGlkYXRvcikgPT4ge1xuICAgICAgICB0aGlzLmFzc2V0U2NoZW1hVmFsaWRhdG9yID0gYXNzZXRTY2hlbWFWYWxpZGF0b3I7XG4gICAgICAgIGNvbnN0IGR1cmluZ1BhZ2VMb2FkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5vbkZpbGVzU2VsZWN0ZWQoZHVyaW5nUGFnZUxvYWQpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGFsbCBsb2NhbCBwcm9maWxlIGluZm9ybWF0aW9uXG4gICAqL1xuICBjbGVhcigpIHtcbiAgICBpZiAodGhpcy5wcm9maWxlKSB7XG4gICAgICB0aGlzLnByb2ZpbGUgPSBudWxsO1xuICAgICAgdGhpcy5wcm9maWxlSWQgPSBudWxsO1xuICAgICAgdGhpcy5hc3NldHMgPSBbXTtcbiAgICAgIHRoaXMubG9jYWxGaWxlc0xpc3RFbGVtZW50LmlubmVySFRNTCA9ICcnO1xuXG4gICAgICBjb25zdCBjaGFuZ2VFdmVudCA9IG5ldyBFdmVudCgnbG9jYWxQcm9maWxlQ2hhbmdlJyk7XG4gICAgICB0aGlzLmRpc3BhdGNoRXZlbnQoY2hhbmdlRXZlbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgc2VsZWN0ZWQgZmlsZXMgYW5kIGdlbmVyYXRlcyBhbiBhc3NldCBwcm9maWxlXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZHVyaW5nUGFnZUxvYWRcbiAgICovXG4gIGFzeW5jIG9uRmlsZXNTZWxlY3RlZChkdXJpbmdQYWdlTG9hZCkge1xuICAgIHRoaXMuY2xlYXIoKTtcblxuICAgIC8vIFNraXAgaWYgaW5pdGlhbHphdGlvbiBpcyBpbmNvbXBsZXRlXG4gICAgaWYgKCF0aGlzLmFzc2V0U2NoZW1hVmFsaWRhdG9yKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRXhhbWluZSB0aGUgZmlsZXMgc2VsZWN0ZWQgdG8gZmluZCB0aGUgcmVnaXN0cnkgcHJvZmlsZSwgYXNzZXQgb3ZlcnJpZGVzLCBhbmQgYXNzZXQgZmlsZXNcbiAgICBjb25zdCBhc3NldHMgPSBbXTtcbiAgICBsZXQgYXNzZXRKc29uRmlsZTtcbiAgICBsZXQgcmVnaXN0cnlKc29uRmlsZTtcblxuICAgIGNvbnN0IGZpbGVzTGlzdCA9IEFycmF5LmZyb20odGhpcy5maWxlc1NlbGVjdG9yLmZpbGVzKTtcbiAgICBmaWxlc0xpc3QuZm9yRWFjaCgoZmlsZSkgPT4ge1xuICAgICAgaWYgKGZpbGUubmFtZS5lbmRzV2l0aCgnLmdsYicpKSB7XG4gICAgICAgIGFzc2V0c1tmaWxlLm5hbWVdID0gd2luZG93LlVSTC5jcmVhdGVPYmplY3RVUkwoZmlsZSk7XG4gICAgICB9IGVsc2UgaWYgKGZpbGUubmFtZSA9PT0gJ3Byb2ZpbGUuanNvbicpIHtcbiAgICAgICAgYXNzZXRKc29uRmlsZSA9IGZpbGU7XG4gICAgICB9IGVsc2UgaWYgKGZpbGUubmFtZS5lbmRzV2l0aCgnLmpzb24nKSkge1xuICAgICAgICByZWdpc3RyeUpzb25GaWxlID0gZmlsZTtcbiAgICAgIH1cblxuICAgICAgLy8gTGlzdCB0aGUgZmlsZXMgZm91bmRcbiAgICAgIHRoaXMubG9jYWxGaWxlc0xpc3RFbGVtZW50LmlubmVySFRNTCArPSBgXG4gICAgICAgIDxsaT4ke2ZpbGUubmFtZX08L2xpPlxuICAgICAgYDtcbiAgICB9KTtcblxuICAgIGlmICghcmVnaXN0cnlKc29uRmlsZSkge1xuICAgICAgQXNzZXRFcnJvci5sb2coJ05vIHJlZ2lzdHJ5IHByb2ZpbGUgc2VsZWN0ZWQnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmJ1aWxkUHJvZmlsZShyZWdpc3RyeUpzb25GaWxlLCBhc3NldEpzb25GaWxlLCBhc3NldHMpO1xuICAgIHRoaXMuYXNzZXRzID0gYXNzZXRzO1xuXG4gICAgLy8gQ2hhbmdlIHRoZSBzZWxlY3RlZCBwcm9maWxlIHRvIHRoZSBvbmUganVzdCBsb2FkZWQuICBEbyBub3QgZG8gdGhpcyBvbiBpbml0aWFsIHBhZ2UgbG9hZFxuICAgIC8vIGJlY2F1c2UgdGhlIHNlbGVjdGVkIGZpbGVzIHBlcnNpc3RzIGluIGZpcmVmb3ggYWNyb3NzIHJlZnJlc2hlcywgYnV0IHRoZSB1c2VyIG1heSBoYXZlXG4gICAgLy8gc2VsZWN0ZWQgYSBkaWZmZXJlbnQgaXRlbSBmcm9tIHRoZSBkcm9wZG93blxuICAgIGlmICghZHVyaW5nUGFnZUxvYWQpIHtcbiAgICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSgncHJvZmlsZUlkJywgdGhpcy5wcm9maWxlSWQpO1xuICAgIH1cblxuICAgIC8vIE5vdGlmeSB0aGF0IHRoZSBsb2NhbCBwcm9maWxlIGlzIHJlYWR5IGZvciB1c2VcbiAgICBjb25zdCBjaGFuZ2VFdmVudCA9IG5ldyBFdmVudCgnbG9jYWxwcm9maWxlY2hhbmdlJyk7XG4gICAgdGhpcy5kaXNwYXRjaEV2ZW50KGNoYW5nZUV2ZW50KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZCBhIG1lcmdlZCBwcm9maWxlIGZpbGUgZnJvbSB0aGUgcmVnaXN0cnkgcHJvZmlsZSBhbmQgYXNzZXQgb3ZlcnJpZGVzXG4gICAqIEBwYXJhbSB7Kn0gcmVnaXN0cnlKc29uRmlsZVxuICAgKiBAcGFyYW0geyp9IGFzc2V0SnNvbkZpbGVcbiAgICovXG4gIGFzeW5jIGJ1aWxkUHJvZmlsZShyZWdpc3RyeUpzb25GaWxlLCBhc3NldEpzb25GaWxlKSB7XG4gICAgLy8gTG9hZCB0aGUgcmVnaXN0cnkgSlNPTiBhbmQgdmFsaWRhdGUgaXQgYWdhaW5zdCB0aGUgc2NoZW1hXG4gICAgY29uc3QgcmVnaXN0cnlKc29uID0gYXdhaXQgTG9jYWxQcm9maWxlLmxvYWRMb2NhbEpzb24ocmVnaXN0cnlKc29uRmlsZSk7XG4gICAgY29uc3QgaXNSZWdpc3RyeUpzb25WYWxpZCA9IHRoaXMucmVnaXN0cnlTY2hlbWFWYWxpZGF0b3IocmVnaXN0cnlKc29uKTtcbiAgICBpZiAoIWlzUmVnaXN0cnlKc29uVmFsaWQpIHtcbiAgICAgIHRocm93IG5ldyBBc3NldEVycm9yKEpTT04uc3RyaW5naWZ5KHRoaXMucmVnaXN0cnlTY2hlbWFWYWxpZGF0b3IuZXJyb3JzLCBudWxsLCAyKSk7XG4gICAgfVxuXG4gICAgLy8gTG9hZCB0aGUgYXNzZXQgSlNPTiBhbmQgdmFsaWRhdGUgaXQgYWdhaW5zdCB0aGUgc2NoZW1hLlxuICAgIC8vIElmIG5vIGFzc2V0IEpTT04gcHJlc2VudCwgdXNlIHRoZSBkZWZhdWx0IGRlZmluaXRvblxuICAgIGxldCBhc3NldEpzb247XG4gICAgaWYgKCFhc3NldEpzb25GaWxlKSB7XG4gICAgICBhc3NldEpzb24gPSB7IHByb2ZpbGVJZDogcmVnaXN0cnlKc29uLnByb2ZpbGVJZCwgb3ZlcnJpZGVzOiB7fSB9O1xuICAgIH0gZWxzZSB7XG4gICAgICBhc3NldEpzb24gPSBhd2FpdCBMb2NhbFByb2ZpbGUubG9hZExvY2FsSnNvbihhc3NldEpzb25GaWxlKTtcbiAgICAgIGNvbnN0IGlzQXNzZXRKc29uVmFsaWQgPSB0aGlzLmFzc2V0U2NoZW1hVmFsaWRhdG9yKGFzc2V0SnNvbik7XG4gICAgICBpZiAoIWlzQXNzZXRKc29uVmFsaWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEFzc2V0RXJyb3IoSlNPTi5zdHJpbmdpZnkodGhpcy5hc3NldFNjaGVtYVZhbGlkYXRvci5lcnJvcnMsIG51bGwsIDIpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBub24tc2NoZW1hIHJlcXVpcmVtZW50cyBhbmQgYnVpbGQgYSBjb21iaW5lZCBwcm9maWxlXG4gICAgdmFsaWRhdGVSZWdpc3RyeVByb2ZpbGUocmVnaXN0cnlKc29uKTtcbiAgICBjb25zdCBleHBhbmRlZFJlZ2lzdHJ5UHJvZmlsZSA9IGV4cGFuZFJlZ2lzdHJ5UHJvZmlsZShyZWdpc3RyeUpzb24pO1xuICAgIHRoaXMucHJvZmlsZSA9IGJ1aWxkQXNzZXRQcm9maWxlKGFzc2V0SnNvbiwgZXhwYW5kZWRSZWdpc3RyeVByb2ZpbGUpO1xuICAgIHRoaXMucHJvZmlsZUlkID0gdGhpcy5wcm9maWxlLnByb2ZpbGVJZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBIZWxwZXIgdG8gbG9hZCBKU09OIGZyb20gYSBsb2NhbCBmaWxlXG4gICAqIEBwYXJhbSB7RmlsZX0ganNvbkZpbGVcbiAgICovXG4gIHN0YXRpYyBsb2FkTG9jYWxKc29uKGpzb25GaWxlKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG5cbiAgICAgIHJlYWRlci5vbmxvYWQgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGpzb24gPSBKU09OLnBhcnNlKHJlYWRlci5yZXN1bHQpO1xuICAgICAgICByZXNvbHZlKGpzb24pO1xuICAgICAgfTtcblxuICAgICAgcmVhZGVyLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGBVbmFibGUgdG8gbG9hZCBKU09OIGZyb20gJHtqc29uRmlsZS5uYW1lfWA7XG4gICAgICAgIEFzc2V0RXJyb3IubG9nKGVycm9yTWVzc2FnZSk7XG4gICAgICAgIHJlamVjdChlcnJvck1lc3NhZ2UpO1xuICAgICAgfTtcblxuICAgICAgcmVhZGVyLnJlYWRBc1RleHQoanNvbkZpbGUpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEhlbHBlciB0byBsb2FkIHRoZSBjb21iaW5lZCBzY2hlbWEgZmlsZSBhbmQgY29tcGlsZSBhbiBBSlYgdmFsaWRhdG9yXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzY2hlbWFzUGF0aFxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGJ1aWxkU2NoZW1hVmFsaWRhdG9yKHNjaGVtYXNQYXRoKSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChzY2hlbWFzUGF0aCk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0RXJyb3IocmVzcG9uc2Uuc3RhdHVzVGV4dCk7XG4gICAgfVxuXG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVuZGVmXG4gICAgY29uc3QgYWp2ID0gbmV3IEFqdigpO1xuICAgIGNvbnN0IHNjaGVtYXMgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG4gICAgc2NoZW1hcy5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoc2NoZW1hKSA9PiB7XG4gICAgICBhanYuYWRkU2NoZW1hKHNjaGVtYSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYWp2LmNvbXBpbGUoc2NoZW1hcy5tYWluU2NoZW1hKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBMb2NhbFByb2ZpbGU7XG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBpbXBvcnQvbm8tdW5yZXNvbHZlZCAqL1xuaW1wb3J0IHsgZmV0Y2hQcm9maWxlLCBmZXRjaFByb2ZpbGVzTGlzdCwgTW90aW9uQ29udHJvbGxlciB9IGZyb20gJy4vbW90aW9uLWNvbnRyb2xsZXJzLm1vZHVsZS5qcyc7XG4vKiBlc2xpbnQtZW5hYmxlICovXG5cbmltcG9ydCBBc3NldEVycm9yIGZyb20gJy4vYXNzZXRFcnJvci5qcyc7XG5pbXBvcnQgTG9jYWxQcm9maWxlIGZyb20gJy4vbG9jYWxQcm9maWxlLmpzJztcblxuY29uc3QgcHJvZmlsZXNCYXNlUGF0aCA9ICcuL3Byb2ZpbGVzJztcblxuLyoqXG4gKiBMb2FkcyBwcm9maWxlcyBmcm9tIHRoZSBkaXN0cmlidXRpb24gZm9sZGVyIG5leHQgdG8gdGhlIHZpZXdlcidzIGxvY2F0aW9uXG4gKi9cbmNsYXNzIFByb2ZpbGVTZWxlY3RvciBleHRlbmRzIEV2ZW50VGFyZ2V0IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKTtcblxuICAgIC8vIEdldCB0aGUgcHJvZmlsZSBpZCBzZWxlY3RvciBhbmQgbGlzdGVuIGZvciBjaGFuZ2VzXG4gICAgdGhpcy5wcm9maWxlSWRTZWxlY3RvckVsZW1lbnQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgncHJvZmlsZUlkU2VsZWN0b3InKTtcbiAgICB0aGlzLnByb2ZpbGVJZFNlbGVjdG9yRWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoKSA9PiB7IHRoaXMub25Qcm9maWxlSWRDaGFuZ2UoKTsgfSk7XG5cbiAgICAvLyBHZXQgdGhlIGhhbmRlZG5lc3Mgc2VsZWN0b3IgYW5kIGxpc3RlbiBmb3IgY2hhbmdlc1xuICAgIHRoaXMuaGFuZGVkbmVzc1NlbGVjdG9yRWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdoYW5kZWRuZXNzU2VsZWN0b3InKTtcbiAgICB0aGlzLmhhbmRlZG5lc3NTZWxlY3RvckVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKCkgPT4geyB0aGlzLm9uSGFuZGVkbmVzc0NoYW5nZSgpOyB9KTtcblxuICAgIHRoaXMuZm9yY2VWUlByb2ZpbGVFbGVtZW50ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2ZvcmNlVlJQcm9maWxlJyk7XG5cbiAgICB0aGlzLmxvY2FsUHJvZmlsZSA9IG5ldyBMb2NhbFByb2ZpbGUoKTtcbiAgICB0aGlzLmxvY2FsUHJvZmlsZS5hZGRFdmVudExpc3RlbmVyKCdsb2NhbHByb2ZpbGVjaGFuZ2UnLCAoZXZlbnQpID0+IHsgdGhpcy5vbkxvY2FsUHJvZmlsZUNoYW5nZShldmVudCk7IH0pO1xuXG4gICAgdGhpcy5wcm9maWxlc0xpc3QgPSBudWxsO1xuICAgIHRoaXMucG9wdWxhdGVQcm9maWxlU2VsZWN0b3IoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNldHMgYWxsIHNlbGVjdGVkIHByb2ZpbGUgc3RhdGVcbiAgICovXG4gIGNsZWFyU2VsZWN0ZWRQcm9maWxlKCkge1xuICAgIEFzc2V0RXJyb3IuY2xlYXJBbGwoKTtcbiAgICB0aGlzLnByb2ZpbGUgPSBudWxsO1xuICAgIHRoaXMuaGFuZGVkbmVzcyA9IG51bGw7XG4gIH1cblxuICAvKipcbiAgICogUmV0cmlldmVzIHRoZSBmdWxsIGxpc3Qgb2YgYXZhaWxhYmxlIHByb2ZpbGVzIGFuZCBwb3B1bGF0ZXMgdGhlIGRyb3Bkb3duXG4gICAqL1xuICBhc3luYyBwb3B1bGF0ZVByb2ZpbGVTZWxlY3RvcigpIHtcbiAgICB0aGlzLmNsZWFyU2VsZWN0ZWRQcm9maWxlKCk7XG4gICAgdGhpcy5oYW5kZWRuZXNzU2VsZWN0b3JFbGVtZW50LmlubmVySFRNTCA9ICcnO1xuXG4gICAgLy8gTG9hZCBhbmQgY2xlYXIgbG9jYWwgc3RvcmFnZVxuICAgIGNvbnN0IHN0b3JlZFByb2ZpbGVJZCA9IHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgncHJvZmlsZUlkJyk7XG4gICAgd2luZG93LmxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKCdwcm9maWxlSWQnKTtcblxuICAgIC8vIExvYWQgdGhlIGxpc3Qgb2YgcHJvZmlsZXNcbiAgICBpZiAoIXRoaXMucHJvZmlsZXNMaXN0KSB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLnByb2ZpbGVJZFNlbGVjdG9yRWxlbWVudC5pbm5lckhUTUwgPSAnPG9wdGlvbiB2YWx1ZT1cImxvYWRpbmdcIj5Mb2FkaW5nLi4uPC9vcHRpb24+JztcbiAgICAgICAgdGhpcy5wcm9maWxlc0xpc3QgPSBhd2FpdCBmZXRjaFByb2ZpbGVzTGlzdChwcm9maWxlc0Jhc2VQYXRoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMucHJvZmlsZUlkU2VsZWN0b3JFbGVtZW50LmlubmVySFRNTCA9ICdGYWlsZWQgdG8gbG9hZCBsaXN0JztcbiAgICAgICAgQXNzZXRFcnJvci5sb2coZXJyb3IubWVzc2FnZSk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCBlYWNoIHByb2ZpbGUgdG8gdGhlIGRyb3Bkb3duXG4gICAgdGhpcy5wcm9maWxlSWRTZWxlY3RvckVsZW1lbnQuaW5uZXJIVE1MID0gJyc7XG4gICAgT2JqZWN0LmtleXModGhpcy5wcm9maWxlc0xpc3QpLmZvckVhY2goKHByb2ZpbGVJZCkgPT4ge1xuICAgICAgdGhpcy5wcm9maWxlSWRTZWxlY3RvckVsZW1lbnQuaW5uZXJIVE1MICs9IGBcbiAgICAgIDxvcHRpb24gdmFsdWU9JyR7cHJvZmlsZUlkfSc+JHtwcm9maWxlSWR9PC9vcHRpb24+XG4gICAgICBgO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIHRoZSBsb2NhbCBwcm9maWxlIGlmIGl0IGlzbid0IGFscmVhZHkgaW5jbHVkZWRcbiAgICBpZiAodGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkXG4gICAgICYmICFPYmplY3Qua2V5cyh0aGlzLnByb2ZpbGVzTGlzdCkuaW5jbHVkZXModGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkKSkge1xuICAgICAgdGhpcy5wcm9maWxlSWRTZWxlY3RvckVsZW1lbnQuaW5uZXJIVE1MICs9IGBcbiAgICAgIDxvcHRpb24gdmFsdWU9JyR7dGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkfSc+JHt0aGlzLmxvY2FsUHJvZmlsZS5wcm9maWxlSWR9PC9vcHRpb24+XG4gICAgICBgO1xuICAgICAgdGhpcy5wcm9maWxlc0xpc3RbdGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkXSA9IHRoaXMubG9jYWxQcm9maWxlO1xuICAgIH1cblxuICAgIC8vIE92ZXJyaWRlIHRoZSBkZWZhdWx0IHNlbGVjdGlvbiBpZiB2YWx1ZXMgd2VyZSBwcmVzZW50IGluIGxvY2FsIHN0b3JhZ2VcbiAgICBpZiAoc3RvcmVkUHJvZmlsZUlkKSB7XG4gICAgICB0aGlzLnByb2ZpbGVJZFNlbGVjdG9yRWxlbWVudC52YWx1ZSA9IHN0b3JlZFByb2ZpbGVJZDtcbiAgICB9XG5cbiAgICAvLyBNYW51YWxseSB0cmlnZ2VyIHNlbGVjdGVkIHByb2ZpbGUgdG8gbG9hZFxuICAgIHRoaXMub25Qcm9maWxlSWRDaGFuZ2UoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGVyIGZvciB0aGUgcHJvZmlsZSBpZCBzZWxlY3Rpb24gY2hhbmdlXG4gICAqL1xuICBvblByb2ZpbGVJZENoYW5nZSgpIHtcbiAgICB0aGlzLmNsZWFyU2VsZWN0ZWRQcm9maWxlKCk7XG4gICAgdGhpcy5oYW5kZWRuZXNzU2VsZWN0b3JFbGVtZW50LmlubmVySFRNTCA9ICcnO1xuXG4gICAgY29uc3QgcHJvZmlsZUlkID0gdGhpcy5wcm9maWxlSWRTZWxlY3RvckVsZW1lbnQudmFsdWU7XG4gICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdwcm9maWxlSWQnLCBwcm9maWxlSWQpO1xuXG4gICAgaWYgKHByb2ZpbGVJZCA9PT0gdGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkKSB7XG4gICAgICB0aGlzLnByb2ZpbGUgPSB0aGlzLmxvY2FsUHJvZmlsZS5wcm9maWxlO1xuICAgICAgdGhpcy5wb3B1bGF0ZUhhbmRlZG5lc3NTZWxlY3RvcigpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBdHRlbXB0IHRvIGxvYWQgdGhlIHByb2ZpbGVcbiAgICAgIHRoaXMucHJvZmlsZUlkU2VsZWN0b3JFbGVtZW50LmRpc2FibGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuaGFuZGVkbmVzc1NlbGVjdG9yRWxlbWVudC5kaXNhYmxlZCA9IHRydWU7XG4gICAgICBmZXRjaFByb2ZpbGUoeyBwcm9maWxlczogW3Byb2ZpbGVJZF0gfSwgcHJvZmlsZXNCYXNlUGF0aCwgZmFsc2UpLnRoZW4oKHsgcHJvZmlsZSB9KSA9PiB7XG4gICAgICAgIHRoaXMucHJvZmlsZSA9IHByb2ZpbGU7XG4gICAgICAgIHRoaXMucG9wdWxhdGVIYW5kZWRuZXNzU2VsZWN0b3IoKTtcbiAgICAgIH0pXG4gICAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICBBc3NldEVycm9yLmxvZyhlcnJvci5tZXNzYWdlKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfSlcbiAgICAgICAgLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICAgIHRoaXMucHJvZmlsZUlkU2VsZWN0b3JFbGVtZW50LmRpc2FibGVkID0gZmFsc2U7XG4gICAgICAgICAgdGhpcy5oYW5kZWRuZXNzU2VsZWN0b3JFbGVtZW50LmRpc2FibGVkID0gZmFsc2U7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQb3B1bGF0ZXMgdGhlIGhhbmRlZG5lc3MgZHJvcGRvd24gd2l0aCB0aG9zZSBzdXBwb3J0ZWQgYnkgdGhlIHNlbGVjdGVkIHByb2ZpbGVcbiAgICovXG4gIHBvcHVsYXRlSGFuZGVkbmVzc1NlbGVjdG9yKCkge1xuICAgIC8vIExvYWQgYW5kIGNsZWFyIHRoZSBsYXN0IHNlbGVjdGlvbiBmb3IgdGhpcyBwcm9maWxlIGlkXG4gICAgY29uc3Qgc3RvcmVkSGFuZGVkbmVzcyA9IHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnaGFuZGVkbmVzcycpO1xuICAgIHdpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbSgnaGFuZGVkbmVzcycpO1xuXG4gICAgLy8gUG9wdWxhdGUgaGFuZGVkbmVzcyBzZWxlY3RvclxuICAgIE9iamVjdC5rZXlzKHRoaXMucHJvZmlsZS5sYXlvdXRzKS5mb3JFYWNoKChoYW5kZWRuZXNzKSA9PiB7XG4gICAgICB0aGlzLmhhbmRlZG5lc3NTZWxlY3RvckVsZW1lbnQuaW5uZXJIVE1MICs9IGBcbiAgICAgICAgPG9wdGlvbiB2YWx1ZT0nJHtoYW5kZWRuZXNzfSc+JHtoYW5kZWRuZXNzfTwvb3B0aW9uPlxuICAgICAgYDtcbiAgICB9KTtcblxuICAgIC8vIEFwcGx5IHN0b3JlZCBoYW5kZWRuZXNzIGlmIGZvdW5kXG4gICAgaWYgKHN0b3JlZEhhbmRlZG5lc3MgJiYgdGhpcy5wcm9maWxlLmxheW91dHNbc3RvcmVkSGFuZGVkbmVzc10pIHtcbiAgICAgIHRoaXMuaGFuZGVkbmVzc1NlbGVjdG9yRWxlbWVudC52YWx1ZSA9IHN0b3JlZEhhbmRlZG5lc3M7XG4gICAgfVxuXG4gICAgLy8gTWFudWFsbHkgdHJpZ2dlciBzZWxlY3RlZCBoYW5kZWRuZXNzIGNoYW5nZVxuICAgIHRoaXMub25IYW5kZWRuZXNzQ2hhbmdlKCk7XG4gIH1cblxuICAvKipcbiAgICogUmVzcG9uZHMgdG8gY2hhbmdlcyBpbiBzZWxlY3RlZCBoYW5kZWRuZXNzLlxuICAgKiBDcmVhdGVzIGEgbmV3IG1vdGlvbiBjb250cm9sbGVyIGZvciB0aGUgY29tYmluYXRpb24gb2YgcHJvZmlsZSBhbmQgaGFuZGVkbmVzcywgYW5kIGZpcmVzIGFuXG4gICAqIGV2ZW50IHRvIHNpZ25hbCB0aGUgY2hhbmdlXG4gICAqL1xuICBvbkhhbmRlZG5lc3NDaGFuZ2UoKSB7XG4gICAgQXNzZXRFcnJvci5jbGVhckFsbCgpO1xuICAgIHRoaXMuaGFuZGVkbmVzcyA9IHRoaXMuaGFuZGVkbmVzc1NlbGVjdG9yRWxlbWVudC52YWx1ZTtcbiAgICB3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2hhbmRlZG5lc3MnLCB0aGlzLmhhbmRlZG5lc3MpO1xuICAgIGlmICh0aGlzLmhhbmRlZG5lc3MpIHtcbiAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ3NlbGVjdGlvbmNoYW5nZScpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnc2VsZWN0aW9uY2xlYXInKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZXMgdGhlIHByb2ZpbGVzIGRyb3Bkb3duIHRvIGVuc3VyZSBsb2NhbCBwcm9maWxlIGlzIGluIHRoZSBsaXN0XG4gICAqL1xuICBvbkxvY2FsUHJvZmlsZUNoYW5nZSgpIHtcbiAgICB0aGlzLnBvcHVsYXRlUHJvZmlsZVNlbGVjdG9yKCk7XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlcyB0aGUgcHJvZmlsZXMgZHJvcGRvd24gdG8gZW5zdXJlIGxvY2FsIHByb2ZpbGUgaXMgaW4gdGhlIGxpc3RcbiAgICovXG4gIGdldCBmb3JjZVZSUHJvZmlsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5mb3JjZVZSUHJvZmlsZUVsZW1lbnQuY2hlY2tlZDtcbiAgfVxuXG4gIC8qKlxuICAgKiBCdWlsZHMgYSBNb3Rpb25Db250cm9sbGVyIGVpdGhlciBiYXNlZCBvbiB0aGUgc3VwcGxpZWQgaW5wdXQgc291cmNlIHVzaW5nIHRoZSBsb2NhbCBwcm9maWxlXG4gICAqIGlmIGl0IGlzIHRoZSBiZXN0IG1hdGNoLCBvdGhlcndpc2UgdXNlcyB0aGUgcmVtb3RlIGFzc2V0c1xuICAgKiBAcGFyYW0ge1hSSW5wdXRTb3VyY2V9IHhySW5wdXRTb3VyY2VcbiAgICovXG4gIGFzeW5jIGNyZWF0ZU1vdGlvbkNvbnRyb2xsZXIoeHJJbnB1dFNvdXJjZSkge1xuICAgIGxldCBwcm9maWxlO1xuICAgIGxldCBhc3NldFBhdGg7XG5cbiAgICAvLyBDaGVjayBpZiBsb2NhbCBvdmVycmlkZSBzaG91bGQgYmUgdXNlZFxuICAgIGxldCB1c2VMb2NhbFByb2ZpbGUgPSBmYWxzZTtcbiAgICBpZiAodGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkKSB7XG4gICAgICB4cklucHV0U291cmNlLnByb2ZpbGVzLnNvbWUoKHByb2ZpbGVJZCkgPT4ge1xuICAgICAgICBjb25zdCBtYXRjaEZvdW5kID0gT2JqZWN0LmtleXModGhpcy5wcm9maWxlc0xpc3QpLmluY2x1ZGVzKHByb2ZpbGVJZCk7XG4gICAgICAgIHVzZUxvY2FsUHJvZmlsZSA9IG1hdGNoRm91bmQgJiYgKHByb2ZpbGVJZCA9PT0gdGhpcy5sb2NhbFByb2ZpbGUucHJvZmlsZUlkKTtcbiAgICAgICAgcmV0dXJuIG1hdGNoRm91bmQ7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBHZXQgcHJvZmlsZSBhbmQgYXNzZXQgcGF0aFxuICAgIGlmICh1c2VMb2NhbFByb2ZpbGUpIHtcbiAgICAgICh7IHByb2ZpbGUgfSA9IHRoaXMubG9jYWxQcm9maWxlKTtcbiAgICAgIGNvbnN0IGFzc2V0TmFtZSA9IHRoaXMubG9jYWxQcm9maWxlLnByb2ZpbGUubGF5b3V0c1t4cklucHV0U291cmNlLmhhbmRlZG5lc3NdLmFzc2V0UGF0aDtcbiAgICAgIGFzc2V0UGF0aCA9IHRoaXMubG9jYWxQcm9maWxlLmFzc2V0c1thc3NldE5hbWVdIHx8IGFzc2V0TmFtZTtcbiAgICB9IGVsc2Uge1xuICAgICAgKHsgcHJvZmlsZSwgYXNzZXRQYXRoIH0gPSBhd2FpdCBmZXRjaFByb2ZpbGUoeHJJbnB1dFNvdXJjZSwgcHJvZmlsZXNCYXNlUGF0aCkpO1xuICAgIH1cblxuICAgIC8vIEJ1aWxkIG1vdGlvbiBjb250cm9sbGVyXG4gICAgY29uc3QgbW90aW9uQ29udHJvbGxlciA9IG5ldyBNb3Rpb25Db250cm9sbGVyKFxuICAgICAgeHJJbnB1dFNvdXJjZSxcbiAgICAgIHByb2ZpbGUsXG4gICAgICBhc3NldFBhdGhcbiAgICApO1xuXG4gICAgcmV0dXJuIG1vdGlvbkNvbnRyb2xsZXI7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHJvZmlsZVNlbGVjdG9yO1xuIiwiY29uc3QgZGVmYXVsdEJhY2tncm91bmQgPSAnZ2VvcmdlbnRvcic7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhY2tncm91bmRTZWxlY3RvciBleHRlbmRzIEV2ZW50VGFyZ2V0IHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKTtcblxuICAgIHRoaXMuYmFja2dyb3VuZFNlbGVjdG9yRWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdiYWNrZ3JvdW5kU2VsZWN0b3InKTtcbiAgICB0aGlzLmJhY2tncm91bmRTZWxlY3RvckVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKCkgPT4geyB0aGlzLm9uQmFja2dyb3VuZENoYW5nZSgpOyB9KTtcblxuICAgIHRoaXMuc2VsZWN0ZWRCYWNrZ3JvdW5kID0gd2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKCdiYWNrZ3JvdW5kJykgfHwgZGVmYXVsdEJhY2tncm91bmQ7XG4gICAgdGhpcy5iYWNrZ3JvdW5kTGlzdCA9IHt9O1xuICAgIGZldGNoKCdiYWNrZ3JvdW5kcy9iYWNrZ3JvdW5kcy5qc29uJylcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHJlc3BvbnNlLmpzb24oKSlcbiAgICAgIC50aGVuKChiYWNrZ3JvdW5kcykgPT4ge1xuICAgICAgICB0aGlzLmJhY2tncm91bmRMaXN0ID0gYmFja2dyb3VuZHM7XG4gICAgICAgIE9iamVjdC5rZXlzKGJhY2tncm91bmRzKS5mb3JFYWNoKChiYWNrZ3JvdW5kKSA9PiB7XG4gICAgICAgICAgY29uc3Qgb3B0aW9uID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnb3B0aW9uJyk7XG4gICAgICAgICAgb3B0aW9uLnZhbHVlID0gYmFja2dyb3VuZDtcbiAgICAgICAgICBvcHRpb24uaW5uZXJUZXh0ID0gYmFja2dyb3VuZDtcbiAgICAgICAgICBpZiAodGhpcy5zZWxlY3RlZEJhY2tncm91bmQgPT09IGJhY2tncm91bmQpIHtcbiAgICAgICAgICAgIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuYmFja2dyb3VuZFNlbGVjdG9yRWxlbWVudC5hcHBlbmRDaGlsZChvcHRpb24pO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnc2VsZWN0aW9uY2hhbmdlJykpO1xuICAgICAgfSk7XG4gIH1cblxuICBvbkJhY2tncm91bmRDaGFuZ2UoKSB7XG4gICAgdGhpcy5zZWxlY3RlZEJhY2tncm91bmQgPSB0aGlzLmJhY2tncm91bmRTZWxlY3RvckVsZW1lbnQudmFsdWU7XG4gICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKCdiYWNrZ3JvdW5kJywgdGhpcy5zZWxlY3RlZEJhY2tncm91bmQpO1xuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ3NlbGVjdGlvbmNoYW5nZScpKTtcbiAgfVxuXG4gIGdldCBiYWNrZ3JvdW5kUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5iYWNrZ3JvdW5kTGlzdFt0aGlzLnNlbGVjdGVkQmFja2dyb3VuZF07XG4gIH1cbn1cbiIsImNvbnN0IENvbnN0YW50cyA9IHtcbiAgSGFuZGVkbmVzczogT2JqZWN0LmZyZWV6ZSh7XG4gICAgTk9ORTogJ25vbmUnLFxuICAgIExFRlQ6ICdsZWZ0JyxcbiAgICBSSUdIVDogJ3JpZ2h0J1xuICB9KSxcblxuICBDb21wb25lbnRTdGF0ZTogT2JqZWN0LmZyZWV6ZSh7XG4gICAgREVGQVVMVDogJ2RlZmF1bHQnLFxuICAgIFRPVUNIRUQ6ICd0b3VjaGVkJyxcbiAgICBQUkVTU0VEOiAncHJlc3NlZCdcbiAgfSksXG5cbiAgQ29tcG9uZW50UHJvcGVydHk6IE9iamVjdC5mcmVlemUoe1xuICAgIEJVVFRPTjogJ2J1dHRvbicsXG4gICAgWF9BWElTOiAneEF4aXMnLFxuICAgIFlfQVhJUzogJ3lBeGlzJyxcbiAgICBTVEFURTogJ3N0YXRlJ1xuICB9KSxcblxuICBDb21wb25lbnRUeXBlOiBPYmplY3QuZnJlZXplKHtcbiAgICBUUklHR0VSOiAndHJpZ2dlcicsXG4gICAgU1FVRUVaRTogJ3NxdWVlemUnLFxuICAgIFRPVUNIUEFEOiAndG91Y2hwYWQnLFxuICAgIFRIVU1CU1RJQ0s6ICd0aHVtYnN0aWNrJyxcbiAgICBCVVRUT046ICdidXR0b24nXG4gIH0pLFxuXG4gIEJ1dHRvblRvdWNoVGhyZXNob2xkOiAwLjA1LFxuXG4gIEF4aXNUb3VjaFRocmVzaG9sZDogMC4xLFxuXG4gIFZpc3VhbFJlc3BvbnNlUHJvcGVydHk6IE9iamVjdC5mcmVlemUoe1xuICAgIFRSQU5TRk9STTogJ3RyYW5zZm9ybScsXG4gICAgVklTSUJJTElUWTogJ3Zpc2liaWxpdHknXG4gIH0pXG59O1xuXG5leHBvcnQgZGVmYXVsdCBDb25zdGFudHM7XG4iLCJpbXBvcnQgQ29uc3RhbnRzIGZyb20gJy4uLy4uLy4uL21vdGlvbi1jb250cm9sbGVycy9zcmMvY29uc3RhbnRzLmpzJztcblxuLyoqXG4gKiBBIGZhbHNlIGdhbWVwYWQgdG8gYmUgdXNlZCBpbiB0ZXN0c1xuICovXG5jbGFzcyBNb2NrR2FtZXBhZCB7XG4gIC8qKlxuICAgKiBAcGFyYW0ge09iamVjdH0gcHJvZmlsZURlc2NyaXB0aW9uIC0gVGhlIHByb2ZpbGUgZGVzY3JpcHRpb24gdG8gcGFyc2UgdG8gZGV0ZXJtaW5lIHRoZSBsZW5ndGhcbiAgICogb2YgdGhlIGJ1dHRvbiBhbmQgYXhlcyBhcnJheXNcbiAgICogQHBhcmFtIHtzdHJpbmd9IGhhbmRlZG5lc3MgLSBUaGUgZ2FtZXBhZCdzIGhhbmRlZG5lc3NcbiAgICovXG4gIGNvbnN0cnVjdG9yKHByb2ZpbGVEZXNjcmlwdGlvbiwgaGFuZGVkbmVzcykge1xuICAgIGlmICghcHJvZmlsZURlc2NyaXB0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHByb2ZpbGVEZXNjcmlwdGlvbiBzdXBwbGllZCcpO1xuICAgIH1cblxuICAgIGlmICghaGFuZGVkbmVzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBoYW5kZWRuZXNzIHN1cHBsaWVkJyk7XG4gICAgfVxuXG4gICAgdGhpcy5pZCA9IHByb2ZpbGVEZXNjcmlwdGlvbi5wcm9maWxlSWQ7XG5cbiAgICAvLyBMb29wIHRocm91Z2ggdGhlIHByb2ZpbGUgZGVzY3JpcHRpb24gdG8gZGV0ZXJtaW5lIGhvdyBtYW55IGVsZW1lbnRzIHRvIHB1dCBpbiB0aGUgYnV0dG9uc1xuICAgIC8vIGFuZCBheGVzIGFycmF5c1xuICAgIGxldCBtYXhCdXR0b25JbmRleCA9IDA7XG4gICAgbGV0IG1heEF4aXNJbmRleCA9IDA7XG4gICAgY29uc3QgbGF5b3V0ID0gcHJvZmlsZURlc2NyaXB0aW9uLmxheW91dHNbaGFuZGVkbmVzc107XG4gICAgdGhpcy5tYXBwaW5nID0gbGF5b3V0Lm1hcHBpbmc7XG4gICAgT2JqZWN0LnZhbHVlcyhsYXlvdXQuY29tcG9uZW50cykuZm9yRWFjaCgoeyBnYW1lcGFkSW5kaWNlcyB9KSA9PiB7XG4gICAgICBjb25zdCB7XG4gICAgICAgIFtDb25zdGFudHMuQ29tcG9uZW50UHJvcGVydHkuQlVUVE9OXTogYnV0dG9uSW5kZXgsXG4gICAgICAgIFtDb25zdGFudHMuQ29tcG9uZW50UHJvcGVydHkuWF9BWElTXTogeEF4aXNJbmRleCxcbiAgICAgICAgW0NvbnN0YW50cy5Db21wb25lbnRQcm9wZXJ0eS5ZX0FYSVNdOiB5QXhpc0luZGV4XG4gICAgICB9ID0gZ2FtZXBhZEluZGljZXM7XG5cbiAgICAgIGlmIChidXR0b25JbmRleCAhPT0gdW5kZWZpbmVkICYmIGJ1dHRvbkluZGV4ID4gbWF4QnV0dG9uSW5kZXgpIHtcbiAgICAgICAgbWF4QnV0dG9uSW5kZXggPSBidXR0b25JbmRleDtcbiAgICAgIH1cblxuICAgICAgaWYgKHhBeGlzSW5kZXggIT09IHVuZGVmaW5lZCAmJiAoeEF4aXNJbmRleCA+IG1heEF4aXNJbmRleCkpIHtcbiAgICAgICAgbWF4QXhpc0luZGV4ID0geEF4aXNJbmRleDtcbiAgICAgIH1cblxuICAgICAgaWYgKHlBeGlzSW5kZXggIT09IHVuZGVmaW5lZCAmJiAoeUF4aXNJbmRleCA+IG1heEF4aXNJbmRleCkpIHtcbiAgICAgICAgbWF4QXhpc0luZGV4ID0geUF4aXNJbmRleDtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEZpbGwgdGhlIGF4ZXMgYXJyYXlcbiAgICB0aGlzLmF4ZXMgPSBbXTtcbiAgICB3aGlsZSAodGhpcy5heGVzLmxlbmd0aCA8PSBtYXhBeGlzSW5kZXgpIHtcbiAgICAgIHRoaXMuYXhlcy5wdXNoKDApO1xuICAgIH1cblxuICAgIC8vIEZpbGwgdGhlIGJ1dHRvbnMgYXJyYXlcbiAgICB0aGlzLmJ1dHRvbnMgPSBbXTtcbiAgICB3aGlsZSAodGhpcy5idXR0b25zLmxlbmd0aCA8PSBtYXhCdXR0b25JbmRleCkge1xuICAgICAgdGhpcy5idXR0b25zLnB1c2goe1xuICAgICAgICB2YWx1ZTogMCxcbiAgICAgICAgdG91Y2hlZDogZmFsc2UsXG4gICAgICAgIHByZXNzZWQ6IGZhbHNlXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9ja0dhbWVwYWQ7XG4iLCIvKipcbiAqIEEgZmFrZSBYUklucHV0U291cmNlIHRoYXQgY2FuIGJlIHVzZWQgdG8gaW5pdGlhbGl6ZSBhIE1vdGlvbkNvbnRyb2xsZXJcbiAqL1xuY2xhc3MgTW9ja1hSSW5wdXRTb3VyY2Uge1xuICAvKipcbiAgICogQHBhcmFtIHtPYmplY3R9IGdhbWVwYWQgLSBUaGUgR2FtZXBhZCBvYmplY3QgdGhhdCBwcm92aWRlcyB0aGUgYnV0dG9uIGFuZCBheGlzIGRhdGFcbiAgICogQHBhcmFtIHtzdHJpbmd9IGhhbmRlZG5lc3MgLSBUaGUgaGFuZGVkbmVzcyB0byByZXBvcnRcbiAgICovXG4gIGNvbnN0cnVjdG9yKHByb2ZpbGVzLCBnYW1lcGFkLCBoYW5kZWRuZXNzKSB7XG4gICAgdGhpcy5nYW1lcGFkID0gZ2FtZXBhZDtcblxuICAgIGlmICghaGFuZGVkbmVzcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBoYW5kZWRuZXNzIHN1cHBsaWVkJyk7XG4gICAgfVxuXG4gICAgdGhpcy5oYW5kZWRuZXNzID0gaGFuZGVkbmVzcztcbiAgICB0aGlzLnByb2ZpbGVzID0gT2JqZWN0LmZyZWV6ZShwcm9maWxlcyk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgTW9ja1hSSW5wdXRTb3VyY2U7XG4iLCIvKiBlc2xpbnQtZGlzYWJsZSBpbXBvcnQvbm8tdW5yZXNvbHZlZCAqL1xuaW1wb3J0ICogYXMgVEhSRUUgZnJvbSAnLi90aHJlZS9idWlsZC90aHJlZS5tb2R1bGUuanMnO1xuaW1wb3J0IHsgT3JiaXRDb250cm9scyB9IGZyb20gJy4vdGhyZWUvZXhhbXBsZXMvanNtL2NvbnRyb2xzL09yYml0Q29udHJvbHMuanMnO1xuaW1wb3J0IHsgUkdCRUxvYWRlciB9IGZyb20gJy4vdGhyZWUvZXhhbXBsZXMvanNtL2xvYWRlcnMvUkdCRUxvYWRlci5qcyc7XG5pbXBvcnQgeyBWUkJ1dHRvbiB9IGZyb20gJy4vdGhyZWUvZXhhbXBsZXMvanNtL3dlYnhyL1ZSQnV0dG9uLmpzJztcbi8qIGVzbGludC1lbmFibGUgKi9cblxuaW1wb3J0IE1hbnVhbENvbnRyb2xzIGZyb20gJy4vbWFudWFsQ29udHJvbHMuanMnO1xuaW1wb3J0IENvbnRyb2xsZXJNb2RlbCBmcm9tICcuL2NvbnRyb2xsZXJNb2RlbC5qcyc7XG5pbXBvcnQgUHJvZmlsZVNlbGVjdG9yIGZyb20gJy4vcHJvZmlsZVNlbGVjdG9yLmpzJztcbmltcG9ydCBCYWNrZ3JvdW5kU2VsZWN0b3IgZnJvbSAnLi9iYWNrZ3JvdW5kU2VsZWN0b3IuanMnO1xuaW1wb3J0IEFzc2V0RXJyb3IgZnJvbSAnLi9hc3NldEVycm9yLmpzJztcbmltcG9ydCBNb2NrR2FtZXBhZCBmcm9tICcuL21vY2tzL21vY2tHYW1lcGFkLmpzJztcbmltcG9ydCBNb2NrWFJJbnB1dFNvdXJjZSBmcm9tICcuL21vY2tzL21vY2tYUklucHV0U291cmNlLmpzJztcblxuY29uc3QgdGhyZWUgPSB7fTtcbmxldCBjYW52YXNQYXJlbnRFbGVtZW50O1xuXG5sZXQgcHJvZmlsZVNlbGVjdG9yO1xubGV0IGJhY2tncm91bmRTZWxlY3RvcjtcbmxldCBtb2NrQ29udHJvbGxlck1vZGVsO1xubGV0IGlzSW1tZXJzaXZlID0gZmFsc2U7XG5cbi8qKlxuICogQWRkcyB0aGUgZXZlbnQgaGFuZGxlcnMgZm9yIFZSIG1vdGlvbiBjb250cm9sbGVycyB0byBsb2FkIHRoZSBhc3NldHMgb24gY29ubmVjdGlvblxuICogYW5kIHJlbW92ZSB0aGVtIG9uIGRpc2Nvbm5lY3Rpb25cbiAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleFxuICovXG5mdW5jdGlvbiBpbml0aWFsaXplVlJDb250cm9sbGVyKGluZGV4KSB7XG4gIGNvbnN0IHZyQ29udHJvbGxlciA9IHRocmVlLnJlbmRlcmVyLnhyLmdldENvbnRyb2xsZXIoaW5kZXgpO1xuXG4gIHZyQ29udHJvbGxlci5hZGRFdmVudExpc3RlbmVyKCdjb25uZWN0ZWQnLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICBjb25zdCBjb250cm9sbGVyTW9kZWwgPSBuZXcgQ29udHJvbGxlck1vZGVsKCk7XG4gICAgdnJDb250cm9sbGVyLmFkZChjb250cm9sbGVyTW9kZWwpO1xuXG4gICAgbGV0IHhySW5wdXRTb3VyY2UgPSBldmVudC5kYXRhO1xuICAgIGlmIChwcm9maWxlU2VsZWN0b3IuZm9yY2VWUlByb2ZpbGUpIHtcbiAgICAgIHhySW5wdXRTb3VyY2UgPSBuZXcgTW9ja1hSSW5wdXRTb3VyY2UoXG4gICAgICAgIFtwcm9maWxlU2VsZWN0b3IucHJvZmlsZS5wcm9maWxlSWRdLCBldmVudC5kYXRhLmdhbWVwYWQsIGV2ZW50LmRhdGEuaGFuZGVkbmVzc1xuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBtb3Rpb25Db250cm9sbGVyID0gYXdhaXQgcHJvZmlsZVNlbGVjdG9yLmNyZWF0ZU1vdGlvbkNvbnRyb2xsZXIoeHJJbnB1dFNvdXJjZSk7XG4gICAgYXdhaXQgY29udHJvbGxlck1vZGVsLmluaXRpYWxpemUobW90aW9uQ29udHJvbGxlcik7XG5cbiAgICBpZiAodGhyZWUuZW52aXJvbm1lbnRNYXApIHtcbiAgICAgIGNvbnRyb2xsZXJNb2RlbC5lbnZpcm9ubWVudE1hcCA9IHRocmVlLmVudmlyb25tZW50TWFwO1xuICAgIH1cbiAgfSk7XG5cbiAgdnJDb250cm9sbGVyLmFkZEV2ZW50TGlzdGVuZXIoJ2Rpc2Nvbm5lY3RlZCcsICgpID0+IHtcbiAgICB2ckNvbnRyb2xsZXIucmVtb3ZlKHZyQ29udHJvbGxlci5jaGlsZHJlblswXSk7XG4gIH0pO1xuXG4gIHRocmVlLnNjZW5lLmFkZCh2ckNvbnRyb2xsZXIpO1xufVxuXG4vKipcbiAqIFRoZSB0aHJlZS5qcyByZW5kZXIgbG9vcCAodXNlZCBpbnN0ZWFkIG9mIHJlcXVlc3RBbmltYXRpb25GcmFtZSB0byBzdXBwb3J0IFhSKVxuICovXG5mdW5jdGlvbiByZW5kZXIoKSB7XG4gIGlmIChtb2NrQ29udHJvbGxlck1vZGVsKSB7XG4gICAgaWYgKGlzSW1tZXJzaXZlKSB7XG4gICAgICB0aHJlZS5zY2VuZS5yZW1vdmUobW9ja0NvbnRyb2xsZXJNb2RlbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocmVlLnNjZW5lLmFkZChtb2NrQ29udHJvbGxlck1vZGVsKTtcbiAgICAgIE1hbnVhbENvbnRyb2xzLnVwZGF0ZVRleHQoKTtcbiAgICB9XG4gIH1cblxuICB0aHJlZS5jYW1lcmFDb250cm9scy51cGRhdGUoKTtcblxuICB0aHJlZS5yZW5kZXJlci5yZW5kZXIodGhyZWUuc2NlbmUsIHRocmVlLmNhbWVyYSk7XG59XG5cbi8qKlxuICogQGRlc2NyaXB0aW9uIEV2ZW50IGhhbmRsZXIgZm9yIHdpbmRvdyByZXNpemluZy5cbiAqL1xuZnVuY3Rpb24gb25SZXNpemUoKSB7XG4gIGNvbnN0IHdpZHRoID0gY2FudmFzUGFyZW50RWxlbWVudC5jbGllbnRXaWR0aDtcbiAgY29uc3QgaGVpZ2h0ID0gY2FudmFzUGFyZW50RWxlbWVudC5jbGllbnRIZWlnaHQ7XG4gIHRocmVlLmNhbWVyYS5hc3BlY3RSYXRpbyA9IHdpZHRoIC8gaGVpZ2h0O1xuICB0aHJlZS5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuICB0aHJlZS5yZW5kZXJlci5zZXRTaXplKHdpZHRoLCBoZWlnaHQpO1xuICB0aHJlZS5jYW1lcmFDb250cm9scy51cGRhdGUoKTtcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplcyB0aGUgdGhyZWUuanMgcmVzb3VyY2VzIG5lZWRlZCBmb3IgdGhpcyBwYWdlXG4gKi9cbmZ1bmN0aW9uIGluaXRpYWxpemVUaHJlZSgpIHtcbiAgY2FudmFzUGFyZW50RWxlbWVudCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdtb2RlbFZpZXdlcicpO1xuICBjb25zdCB3aWR0aCA9IGNhbnZhc1BhcmVudEVsZW1lbnQuY2xpZW50V2lkdGg7XG4gIGNvbnN0IGhlaWdodCA9IGNhbnZhc1BhcmVudEVsZW1lbnQuY2xpZW50SGVpZ2h0O1xuXG4gIC8vIFNldCB1cCB0aGUgVEhSRUUuanMgaW5mcmFzdHJ1Y3R1cmVcbiAgdGhyZWUuY2FtZXJhID0gbmV3IFRIUkVFLlBlcnNwZWN0aXZlQ2FtZXJhKDc1LCB3aWR0aCAvIGhlaWdodCwgMC4wMSwgMTAwMCk7XG4gIHRocmVlLmNhbWVyYS5wb3NpdGlvbi55ID0gMC41O1xuICB0aHJlZS5zY2VuZSA9IG5ldyBUSFJFRS5TY2VuZSgpO1xuICB0aHJlZS5zY2VuZS5iYWNrZ3JvdW5kID0gbmV3IFRIUkVFLkNvbG9yKDB4MDBhYTQ0KTtcbiAgdGhyZWUucmVuZGVyZXIgPSBuZXcgVEhSRUUuV2ViR0xSZW5kZXJlcih7IGFudGlhbGlhczogdHJ1ZSB9KTtcbiAgdGhyZWUucmVuZGVyZXIuc2V0U2l6ZSh3aWR0aCwgaGVpZ2h0KTtcbiAgdGhyZWUucmVuZGVyZXIuZ2FtbWFPdXRwdXQgPSB0cnVlO1xuXG4gIC8vIFNldCB1cCB0aGUgY29udHJvbHMgZm9yIG1vdmluZyB0aGUgc2NlbmUgYXJvdW5kXG4gIHRocmVlLmNhbWVyYUNvbnRyb2xzID0gbmV3IE9yYml0Q29udHJvbHModGhyZWUuY2FtZXJhLCB0aHJlZS5yZW5kZXJlci5kb21FbGVtZW50KTtcbiAgdGhyZWUuY2FtZXJhQ29udHJvbHMuZW5hYmxlRGFtcGluZyA9IHRydWU7XG4gIHRocmVlLmNhbWVyYUNvbnRyb2xzLm1pbkRpc3RhbmNlID0gMC4wNTtcbiAgdGhyZWUuY2FtZXJhQ29udHJvbHMubWF4RGlzdGFuY2UgPSAwLjM7XG4gIHRocmVlLmNhbWVyYUNvbnRyb2xzLmVuYWJsZVBhbiA9IGZhbHNlO1xuICB0aHJlZS5jYW1lcmFDb250cm9scy51cGRhdGUoKTtcblxuICAvLyBBZGQgVlJcbiAgY2FudmFzUGFyZW50RWxlbWVudC5hcHBlbmRDaGlsZChWUkJ1dHRvbi5jcmVhdGVCdXR0b24odGhyZWUucmVuZGVyZXIpKTtcbiAgdGhyZWUucmVuZGVyZXIueHIuZW5hYmxlZCA9IHRydWU7XG4gIHRocmVlLnJlbmRlcmVyLnhyLmFkZEV2ZW50TGlzdGVuZXIoJ3Nlc3Npb25zdGFydCcsICgpID0+IHsgaXNJbW1lcnNpdmUgPSB0cnVlOyB9KTtcbiAgdGhyZWUucmVuZGVyZXIueHIuYWRkRXZlbnRMaXN0ZW5lcignc2Vzc2lvbmVuZCcsICgpID0+IHsgaXNJbW1lcnNpdmUgPSBmYWxzZTsgfSk7XG4gIGluaXRpYWxpemVWUkNvbnRyb2xsZXIoMCk7XG4gIGluaXRpYWxpemVWUkNvbnRyb2xsZXIoMSk7XG5cbiAgLy8gQWRkIHRoZSBUSFJFRS5qcyBjYW52YXMgdG8gdGhlIHBhZ2VcbiAgY2FudmFzUGFyZW50RWxlbWVudC5hcHBlbmRDaGlsZCh0aHJlZS5yZW5kZXJlci5kb21FbGVtZW50KTtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Jlc2l6ZScsIG9uUmVzaXplLCBmYWxzZSk7XG5cbiAgLy8gU3RhcnQgcHVtcGluZyBmcmFtZXNcbiAgdGhyZWUucmVuZGVyZXIuc2V0QW5pbWF0aW9uTG9vcChyZW5kZXIpO1xufVxuXG5mdW5jdGlvbiBvblNlbGVjdGlvbkNsZWFyKCkge1xuICBNYW51YWxDb250cm9scy5jbGVhcigpO1xuICBpZiAobW9ja0NvbnRyb2xsZXJNb2RlbCkge1xuICAgIHRocmVlLnNjZW5lLnJlbW92ZShtb2NrQ29udHJvbGxlck1vZGVsKTtcbiAgICBtb2NrQ29udHJvbGxlck1vZGVsID0gbnVsbDtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBvblNlbGVjdGlvbkNoYW5nZSgpIHtcbiAgb25TZWxlY3Rpb25DbGVhcigpO1xuICBjb25zdCBtb2NrR2FtZXBhZCA9IG5ldyBNb2NrR2FtZXBhZChwcm9maWxlU2VsZWN0b3IucHJvZmlsZSwgcHJvZmlsZVNlbGVjdG9yLmhhbmRlZG5lc3MpO1xuICBjb25zdCBtb2NrWFJJbnB1dFNvdXJjZSA9IG5ldyBNb2NrWFJJbnB1dFNvdXJjZShcbiAgICBbcHJvZmlsZVNlbGVjdG9yLnByb2ZpbGUucHJvZmlsZUlkXSwgbW9ja0dhbWVwYWQsIHByb2ZpbGVTZWxlY3Rvci5oYW5kZWRuZXNzXG4gICk7XG4gIG1vY2tDb250cm9sbGVyTW9kZWwgPSBuZXcgQ29udHJvbGxlck1vZGVsKG1vY2tYUklucHV0U291cmNlKTtcbiAgdGhyZWUuc2NlbmUuYWRkKG1vY2tDb250cm9sbGVyTW9kZWwpO1xuXG4gIGNvbnN0IG1vdGlvbkNvbnRyb2xsZXIgPSBhd2FpdCBwcm9maWxlU2VsZWN0b3IuY3JlYXRlTW90aW9uQ29udHJvbGxlcihtb2NrWFJJbnB1dFNvdXJjZSk7XG4gIE1hbnVhbENvbnRyb2xzLmJ1aWxkKG1vdGlvbkNvbnRyb2xsZXIpO1xuICBhd2FpdCBtb2NrQ29udHJvbGxlck1vZGVsLmluaXRpYWxpemUobW90aW9uQ29udHJvbGxlcik7XG5cbiAgaWYgKHRocmVlLmVudmlyb25tZW50TWFwKSB7XG4gICAgbW9ja0NvbnRyb2xsZXJNb2RlbC5lbnZpcm9ubWVudE1hcCA9IHRocmVlLmVudmlyb25tZW50TWFwO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIG9uQmFja2dyb3VuZENoYW5nZSgpIHtcbiAgY29uc3QgcG1yZW1HZW5lcmF0b3IgPSBuZXcgVEhSRUUuUE1SRU1HZW5lcmF0b3IodGhyZWUucmVuZGVyZXIpO1xuICBwbXJlbUdlbmVyYXRvci5jb21waWxlRXF1aXJlY3Rhbmd1bGFyU2hhZGVyKCk7XG5cbiAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCByZ2JlTG9hZGVyID0gbmV3IFJHQkVMb2FkZXIoKTtcbiAgICByZ2JlTG9hZGVyLnNldERhdGFUeXBlKFRIUkVFLlVuc2lnbmVkQnl0ZVR5cGUpO1xuICAgIHJnYmVMb2FkZXIuc2V0UGF0aCgnYmFja2dyb3VuZHMvJyk7XG4gICAgcmdiZUxvYWRlci5sb2FkKGJhY2tncm91bmRTZWxlY3Rvci5iYWNrZ3JvdW5kUGF0aCwgKHRleHR1cmUpID0+IHtcbiAgICAgIHRocmVlLmVudmlyb25tZW50TWFwID0gcG1yZW1HZW5lcmF0b3IuZnJvbUVxdWlyZWN0YW5ndWxhcih0ZXh0dXJlKS50ZXh0dXJlO1xuICAgICAgdGhyZWUuc2NlbmUuYmFja2dyb3VuZCA9IHRocmVlLmVudmlyb25tZW50TWFwO1xuXG4gICAgICBpZiAobW9ja0NvbnRyb2xsZXJNb2RlbCkge1xuICAgICAgICBtb2NrQ29udHJvbGxlck1vZGVsLmVudmlyb25tZW50TWFwID0gdGhyZWUuZW52aXJvbm1lbnRNYXA7XG4gICAgICB9XG5cbiAgICAgIHBtcmVtR2VuZXJhdG9yLmRpc3Bvc2UoKTtcbiAgICAgIHJlc29sdmUodGhyZWUuZW52aXJvbm1lbnRNYXApO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLyoqXG4gKiBQYWdlIGxvYWQgaGFuZGxlciBmb3IgaW5pdGlhbHppbmcgdGhpbmdzIHRoYXQgZGVwZW5kIG9uIHRoZSBET00gdG8gYmUgcmVhZHlcbiAqL1xuZnVuY3Rpb24gb25Mb2FkKCkge1xuICBBc3NldEVycm9yLmluaXRpYWxpemUoKTtcbiAgcHJvZmlsZVNlbGVjdG9yID0gbmV3IFByb2ZpbGVTZWxlY3RvcigpO1xuICBpbml0aWFsaXplVGhyZWUoKTtcblxuICBwcm9maWxlU2VsZWN0b3IuYWRkRXZlbnRMaXN0ZW5lcignc2VsZWN0aW9uY2xlYXInLCBvblNlbGVjdGlvbkNsZWFyKTtcbiAgcHJvZmlsZVNlbGVjdG9yLmFkZEV2ZW50TGlzdGVuZXIoJ3NlbGVjdGlvbmNoYW5nZScsIG9uU2VsZWN0aW9uQ2hhbmdlKTtcblxuICBiYWNrZ3JvdW5kU2VsZWN0b3IgPSBuZXcgQmFja2dyb3VuZFNlbGVjdG9yKCk7XG4gIGJhY2tncm91bmRTZWxlY3Rvci5hZGRFdmVudExpc3RlbmVyKCdzZWxlY3Rpb25jaGFuZ2UnLCBvbkJhY2tncm91bmRDaGFuZ2UpO1xufVxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBvbkxvYWQpO1xuIl0sIm5hbWVzIjpbIlRIUkVFLk9iamVjdDNEIiwiQ29uc3RhbnRzIiwiVEhSRUUuUXVhdGVybmlvbiIsIlRIUkVFLlNwaGVyZUdlb21ldHJ5IiwiVEhSRUUuTWVzaEJhc2ljTWF0ZXJpYWwiLCJUSFJFRS5NZXNoIiwiVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEiLCJUSFJFRS5TY2VuZSIsIlRIUkVFLkNvbG9yIiwiVEhSRUUuV2ViR0xSZW5kZXJlciIsIlRIUkVFLlBNUkVNR2VuZXJhdG9yIiwiVEhSRUUuVW5zaWduZWRCeXRlVHlwZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQSxJQUFJLGdCQUFnQixDQUFDO0FBQ3JCLElBQUksV0FBVyxDQUFDO0FBQ2hCLElBQUksbUJBQW1CLENBQUM7O0FBRXhCLFNBQVMsVUFBVSxHQUFHO0VBQ3BCLElBQUksZ0JBQWdCLEVBQUU7SUFDcEIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxTQUFTLEtBQUs7TUFDaEUsTUFBTSxXQUFXLEdBQUcsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEVBQUUsU0FBUyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO01BQ3BFLFdBQVcsQ0FBQyxTQUFTLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztLQUNqRSxDQUFDLENBQUM7R0FDSjtDQUNGOztBQUVELFNBQVMsbUJBQW1CLENBQUMsS0FBSyxFQUFFO0VBQ2xD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
