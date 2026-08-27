const colours = {
  'viewport-0': 'rgb(200, 0, 0)',
  'viewport-1': 'rgb(200, 200, 0)',
  'viewport-2': 'rgb(0, 200, 0)',
};

const colorsByOrientation = {
  axial: 'rgb(200, 0, 0)',
  sagittal: 'rgb(200, 200, 0)',
  coronal: 'rgb(0, 200, 0)',
};

function initDefaultToolGroup(extensionManager, toolGroupService, commandsManager, toolGroupId) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames, Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: toolNames.Pan,
        // Displaced from the middle button by WindowLevel (below) - Shift+left-drag pans instead.
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary, modifierKey: Enums.KeyboardBindings.Shift },
        ],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.StackScroll,
        // RadiAnt-style default: left click drag also scrolls, in addition to the wheel.
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary },
          { mouseButton: Enums.MouseBindings.Wheel },
          { numTouchPoints: 3 },
        ],
        configuration: {
          // Drag/wheel forward (down) moves to higher slice numbers - confirmed
          // with the user that the previous invert:true direction felt backward.
          invert: false,
        },
      },
      {
        toolName: toolNames.WindowLevel,
        // Middle-click adjusts window/level by default (left stays Stack Scroll, right stays Zoom).
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.Length,
        // 5-button mouse default: the 4th (back) button measures length,
        // rather than sitting unassigned until the user configures it via
        // the Mouse Bindings popup. Still also togglable onto Primary from
        // the toolbar as normal - this only adds the Fourth_Button binding,
        // it doesn't remove Length's usual toolbar behavior.
        bindings: [{ mouseButton: Enums.MouseBindings.Fourth_Button }],
      },
      {
        toolName: toolNames.Probe,
        // 5-button mouse default: the 5th (forward) button probes pixel
        // values, for the same reason as Length above.
        bindings: [{ mouseButton: Enums.MouseBindings.Fifth_Button }],
      },
      {
        toolName: toolNames.SimpleCrosshair,
        // RadiAnt-style "3D cursor": Ctrl+Shift+Click always places/moves it,
        // regardless of whichever other tool currently owns the plain left
        // click - on top of that, the toolbar button/Q hotkey can toggle it
        // onto the plain Primary button like any other toggleable tool.
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
            modifierKey: Enums.KeyboardBindings.ShiftCtrl,
          },
        ],
      },
    ],
    passive: [
      {
        toolName: toolNames.ArrowAnnotate,
        configuration: {
          getTextCallback: (callback, eventDetails) => {
            commandsManager.runCommand('arrowTextCallback', {
              callback,
              eventDetails,
            });
          },
          changeTextCallback: (data, eventDetails, callback) => {
            commandsManager.runCommand('arrowTextCallback', {
              callback,
              data,
              eventDetails,
            });
          },
        },
      },
      {
        toolName: toolNames.SegmentBidirectional,
      },
      { toolName: toolNames.Bidirectional },
      { toolName: toolNames.DragProbe },
      { toolName: toolNames.EllipticalROI },
      { toolName: toolNames.CircleROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.Magnify },
      { toolName: toolNames.CalibrationLine },
      { toolName: toolNames.Deviation },
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
      { toolName: toolNames.UltrasoundDirectional },
      { toolName: toolNames.PlanarFreehandROI },
      { toolName: toolNames.SplineROI },
      { toolName: toolNames.LivewireContour },
      { toolName: toolNames.WindowLevelRegion },
    ],
    enabled: [
      { toolName: toolNames.ImageOverlayViewer },
      { toolName: toolNames.ReferenceLines },
    ],
    disabled: [
      {
        toolName: toolNames.AdvancedMagnify,
      },
    ],
  };

  const updatedTools = commandsManager.run('initializeSegmentLabelTool', { tools });

  toolGroupService.createToolGroupAndAddTools(toolGroupId, updatedTools);
}

function initSRToolGroup(extensionManager, toolGroupService) {
  const SRUtilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone-dicom-sr.utilityModule.tools'
  );

  if (!SRUtilityModule) {
    return;
  }

  const CS3DUtilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames: SRToolNames } = SRUtilityModule.exports;
  const { toolNames, Enums } = CS3DUtilityModule.exports;
  const tools = {
    active: [
      {
        toolName: toolNames.Pan,
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Auxiliary,
          },
        ],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Secondary,
          },
          { numTouchPoints: 2 },
        ],
      },
      {
        toolName: toolNames.StackScroll,
        // RadiAnt-style default: left click drag also scrolls, in addition to the wheel.
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary },
          { mouseButton: Enums.MouseBindings.Wheel },
          { numTouchPoints: 3 },
        ],
        configuration: {
          // Drag/wheel forward (down) moves to higher slice numbers - confirmed
          // with the user that the previous invert:true direction felt backward.
          invert: false,
        },
      },
    ],
    passive: [
      { toolName: toolNames.WindowLevel },
      { toolName: SRToolNames.SRLength },
      { toolName: SRToolNames.SRArrowAnnotate },
      { toolName: SRToolNames.SRBidirectional },
      { toolName: SRToolNames.SREllipticalROI },
      { toolName: SRToolNames.SRCircleROI },
      { toolName: SRToolNames.SRPlanarFreehandROI },
      { toolName: SRToolNames.SRRectangleROI },
      { toolName: toolNames.WindowLevelRegion },
    ],
    enabled: [
      {
        toolName: SRToolNames.DICOMSRDisplay,
      },
    ],
    // disabled
  };

  const toolGroupId = 'SRToolGroup';
  toolGroupService.createToolGroupAndAddTools(toolGroupId, tools);
}

function initMPRToolGroup(extensionManager, toolGroupService, commandsManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const serviceManager = extensionManager._servicesManager;
  const { cornerstoneViewportService } = serviceManager.services;

  const { toolNames, Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.StackScroll,
        // RadiAnt-style default: left click drag also scrolls, in addition to the wheel.
        bindings: [
          { mouseButton: Enums.MouseBindings.Primary },
          { mouseButton: Enums.MouseBindings.Wheel },
          { numTouchPoints: 3 },
        ],
        configuration: {
          // Drag/wheel forward (down) moves to higher slice numbers - confirmed
          // with the user that the previous invert:true direction felt backward.
          invert: false,
        },
      },
      {
        toolName: toolNames.SimpleCrosshair,
        // Was missing from this tool group entirely (only 'default' had
        // it) - the RadiAnt-style 3D Cursor (Ctrl+Shift+Click, or Q to
        // assign it to the plain Primary button) silently did nothing in
        // MPR/reformat viewports, exactly where cross-plane point
        // correlation (axial/sagittal/coronal) matters most.
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
            modifierKey: Enums.KeyboardBindings.ShiftCtrl,
          },
        ],
      },
    ],
    passive: [
      { toolName: toolNames.WindowLevel },
      { toolName: toolNames.Length },
      {
        toolName: toolNames.ArrowAnnotate,
        configuration: {
          getTextCallback: (callback, eventDetails) => {
            commandsManager.runCommand('arrowTextCallback', {
              callback,
              eventDetails,
            });
          },
          changeTextCallback: (data, eventDetails, callback) => {
            commandsManager.runCommand('arrowTextCallback', {
              callback,
              data,
              eventDetails,
            });
          },
        },
      },
      { toolName: toolNames.Bidirectional },
      { toolName: toolNames.DragProbe },
      { toolName: toolNames.Probe },
      { toolName: toolNames.EllipticalROI },
      { toolName: toolNames.CircleROI },
      { toolName: toolNames.RectangleROI },
      { toolName: toolNames.Angle },
      { toolName: toolNames.CobbAngle },
      { toolName: toolNames.PlanarFreehandROI },
      { toolName: toolNames.SplineROI },
      { toolName: toolNames.LivewireContour },
      { toolName: toolNames.WindowLevelRegion },
      {
        toolName: toolNames.PlanarFreehandContourSegmentation,
        configuration: {
          displayOnePointAsCrosshairs: true,
        },
      },
    ],
    disabled: [
      {
        toolName: toolNames.Crosshairs,
        // No explicit bindings here (matches segmentation mode's MPR tool
        // group) - a plain left-click-drag moves/rotates the crosshairs.
        // This used to require Shift+left-click, which was an inconsistency
        // left over from the item-3/item-4 mouse-binding rework - not an
        // intentional restriction - and made the center-drag interaction
        // silently do nothing on a plain click.
        configuration: {
          // Bigger rotation/manipulation handle for desktop mouse use - default
          // (3) is too small to reliably grab; the actual hit-test radius is
          // patched separately (see patches/@cornerstonejs+tools+*.patch).
          handleRadius: 7,
          viewportIndicators: true,
          viewportIndicatorsConfig: {
            circleRadius: 5,
            xOffset: 0.95,
            yOffset: 0.05,
          },
          autoPan: {
            enabled: false,
            panSize: 10,
          },
          getReferenceLineColor: viewportId => {
            const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
            const viewportOptions = viewportInfo?.viewportOptions;
            if (viewportOptions) {
              return (
                colours[viewportOptions.id] ||
                colorsByOrientation[viewportOptions.orientation] ||
                '#0c0'
              );
            } else {
              console.warn('missing viewport?', viewportId);
              return '#0c0';
            }
          },
        },
      },
      {
        toolName: toolNames.AdvancedMagnify,
      },
      { toolName: toolNames.ReferenceLines },
    ],
  };

  toolGroupService.createToolGroupAndAddTools('mpr', tools);
}
function initVolume3DToolGroup(extensionManager, toolGroupService) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.tools'
  );

  const { toolNames, Enums } = utilityModule.exports;

  const tools = {
    active: [
      {
        toolName: toolNames.TrackballRotateTool,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Zoom,
        bindings: [{ mouseButton: Enums.MouseBindings.Secondary }, { numTouchPoints: 2 }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }, { numTouchPoints: 3 }],
      },
      {
        toolName: toolNames.SimpleCrosshair,
        // Was missing from this tool group entirely (only 'default' had
        // it) - see the same addition in initMPRToolGroup above.
        bindings: [
          {
            mouseButton: Enums.MouseBindings.Primary,
            modifierKey: Enums.KeyboardBindings.ShiftCtrl,
          },
        ],
      },
    ],
  };

  toolGroupService.createToolGroupAndAddTools('volume3d', tools);
}

function initToolGroups(extensionManager, toolGroupService, commandsManager) {
  initDefaultToolGroup(extensionManager, toolGroupService, commandsManager, 'default');
  initSRToolGroup(extensionManager, toolGroupService);
  initMPRToolGroup(extensionManager, toolGroupService, commandsManager);
  initVolume3DToolGroup(extensionManager, toolGroupService);
}

export default initToolGroups;
