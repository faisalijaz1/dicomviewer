export default {
  measurementsContextMenu: {
    inheritsFrom: 'ohif.contextMenu',
    menus: [
      // Get the items from the UI Customization for the menu name (and have a custom name)
      {
        id: 'forExistingMeasurement',
        selector: ({ nearbyToolData }) => !!nearbyToolData,
        items: [
          {
            label: 'Delete measurement',
            commands: 'removeMeasurement',
          },
          {
            label: 'Add Label',
            commands: 'setMeasurementLabel',
          },
          {
            // RadiAnt-parity manual calibration (User Manual v2021.2 sec.
            // 2.7.1). Only meaningful for a straight 2-point measurement
            // (Length/CalibrationLine) - a 4-handle tool like Bidirectional
            // has no single unambiguous "this segment's real length" to
            // calibrate from, so it's excluded here rather than guessing.
            label: 'Calibration',
            selector: ({ nearbyToolData }) =>
              (nearbyToolData?.data as { handles?: { points?: unknown[] } })?.handles?.points
                ?.length === 2,
            commands: 'calibrateMeasurement',
          },
        ],
      },
      {
        // RadiAnt-style general viewport menu (User Manual v2021.2 sec. 20
        // example list: Window/Level, Zoom, Pan, Reset, Rotate, Flip,
        // Invert, Fit) - shown when the right-click didn't land near an
        // existing measurement (the menu above already covers that case
        // and always wins when it applies; findMenuDefault picks the first
        // menu whose selector passes, so this one - no selector, always
        // matches - is only ever reached as the fallback).
        id: 'viewportActions',
        items: [
          {
            label: 'Window/Level',
            commands: { commandName: 'setToolActive', commandOptions: { toolName: 'WindowLevel' } },
          },
          {
            label: 'Zoom',
            commands: { commandName: 'setToolActive', commandOptions: { toolName: 'Zoom' } },
          },
          {
            label: 'Pan',
            commands: { commandName: 'setToolActive', commandOptions: { toolName: 'Pan' } },
          },
          {
            label: 'Reset',
            commands: 'resetViewport',
          },
          {
            label: 'Fit to Window',
            commands: 'fitViewportToWindow',
          },
          {
            label: 'Rotate Right',
            commands: 'rotateViewportCW',
          },
          {
            label: 'Flip Horizontal',
            commands: 'flipViewportHorizontal',
          },
          {
            label: 'Flip Vertical',
            commands: 'flipViewportVertical',
          },
          {
            label: 'Invert',
            commands: 'invertViewport',
          },
        ],
      },
    ],
  },
};
