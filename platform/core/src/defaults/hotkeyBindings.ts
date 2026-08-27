const bindings = [
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Zoom' },
    label: 'Zoom',
    keys: ['z'],
    isEditable: true,
  },
  {
    // RadiAnt: "Ctrl + +: Zoom in" - kept alongside the existing bare '+'
    // binding rather than replacing it.
    commandName: 'scaleUpViewport',
    label: 'Zoom In',
    keys: ['+', 'ctrl++'],
    isEditable: true,
  },
  {
    // RadiAnt: "Ctrl + -: Zoom out".
    commandName: 'scaleDownViewport',
    label: 'Zoom Out',
    keys: ['-', 'ctrl+-'],
    isEditable: true,
  },
  {
    // RadiAnt: "Ctrl + 0: Fit image to viewport".
    commandName: 'fitViewportToWindow',
    label: 'Zoom to Fit',
    keys: ['=', 'ctrl+0'],
    isEditable: true,
  },
  {
    // RadiAnt: "Rotate 90 degrees clockwise: Ctrl + ]".
    commandName: 'rotateViewportCW',
    label: 'Rotate Right',
    keys: ['ctrl+]'],
    isEditable: true,
  },
  {
    // RadiAnt: "Rotate 90 degrees counter clockwise: Ctrl + [". Frees the
    // bare 'l' key for the Length measurement tool (see below).
    commandName: 'rotateViewportCCW',
    label: 'Rotate Left',
    keys: ['ctrl+['],
    isEditable: true,
  },
  {
    // RadiAnt: "Flip horizontal: Ctrl + Shift + [".
    commandName: 'flipViewportHorizontal',
    label: 'Flip Horizontally',
    keys: ['ctrl+shift+['],
    isEditable: true,
  },
  {
    // RadiAnt: "Flip vertical: Ctrl + Shift + ]".
    commandName: 'flipViewportVertical',
    label: 'Flip Vertically',
    keys: ['ctrl+shift+]'],
    isEditable: true,
  },
  {
    // RadiAnt: "Start/stop cine: Space". Frees the bare 'c' key for the
    // Cobb angle measurement tool (see below).
    commandName: 'toggleCine',
    label: 'Cine',
    keys: ['space'],
  },
  {
    // RadiAnt: "Negative: F11".
    commandName: 'invertViewport',
    label: 'Invert',
    keys: ['f11'],
    isEditable: true,
  },
  {
    commandName: 'togglePatientInfoVisibility',
    label: 'Toggle Patient Info',
    keys: ['f12'],
    isEditable: true,
  },
  {
    // RadiAnt: "Left Arrow: Previous series" / "Right Arrow: Next series" -
    // NOT panel navigation (that's Tab/Shift+Tab below, matching RadiAnt).
    commandName: 'updateViewportDisplaySet',
    commandOptions: {
      direction: -1,
    },
    label: 'Previous Series',
    keys: ['left'],
    isEditable: true,
  },
  {
    commandName: 'updateViewportDisplaySet',
    commandOptions: {
      direction: 1,
    },
    label: 'Next Series',
    keys: ['right'],
    isEditable: true,
  },
  {
    // RadiAnt: "Tab: Activate next panel".
    commandName: 'incrementActiveViewport',
    label: 'Next Panel',
    keys: ['tab'],
    isEditable: true,
  },
  {
    // RadiAnt: "Shift + Tab: Activate previous panel".
    commandName: 'decrementActiveViewport',
    label: 'Previous Panel',
    keys: ['shift+tab'],
    isEditable: true,
  },
  {
    // RadiAnt: "Page Up: 10 images backward" - reuses the same scroll
    // command as previousImage/nextImage below with a bigger delta, not
    // series navigation (that moved to Left/Right above).
    commandName: 'previousImage',
    commandOptions: {
      delta: 10,
    },
    label: '10 Images Backward',
    keys: ['pageup'],
    isEditable: true,
  },
  {
    // RadiAnt: "Page Down: 10 images forward".
    commandName: 'nextImage',
    commandOptions: {
      delta: 10,
    },
    label: '10 Images Forward',
    keys: ['pagedown'],
    isEditable: true,
  },
  {
    commandName: 'nextStage',
    context: 'DEFAULT',
    label: 'Next Stage',
    keys: ['.'],
    isEditable: true,
  },
  {
    commandName: 'previousStage',
    context: 'DEFAULT',
    label: 'Previous Stage',
    keys: [','],
    isEditable: true,
  },
  {
    commandName: 'nextImage',
    label: 'Next Image',
    keys: ['down'],
    isEditable: true,
  },
  {
    commandName: 'previousImage',
    label: 'Previous Image',
    keys: ['up'],
    isEditable: true,
  },
  {
    commandName: 'firstImage',
    label: 'First Image',
    keys: ['home'],
    isEditable: true,
  },
  {
    commandName: 'lastImage',
    label: 'Last Image',
    keys: ['end'],
    isEditable: true,
  },
  {
    // Moved off 'space' now that it's RadiAnt's Cine start/stop key (see
    // toggleCine above). Ctrl+R matches RadiAnt's own "Reset view/scene"
    // shortcut used in its 3D MPR and Volume Rendering windows.
    commandName: 'resetViewport',
    label: 'Reset',
    keys: ['ctrl+r'],
    isEditable: true,
  },
  {
    // RadiAnt: "Clear transformation: Ctrl + Shift + \". Rotation/flip only -
    // distinct from Reset above, which also resets zoom/pan/window-level.
    commandName: 'clearViewportTransformations',
    label: 'Clear Transformations',
    keys: ['ctrl+shift+\\'],
    isEditable: true,
  },
  {
    // Not in RadiAnt's shortcut table (only CW/CCW have dedicated keys there,
    // per its Features list "Rotate (90 CW, 90 CCW, 180)") - 'r' was left
    // free after rotateViewportCW/CCW moved to Ctrl+]/Ctrl+[ above, and reads
    // naturally as "Rotate".
    commandName: 'rotateViewport180',
    label: 'Rotate 180°',
    keys: ['r'],
    isEditable: true,
  },
  // presetIndex ("the Nth preset for whichever modality is currently
  // active"), not a specific named CT preset id - so these same 7 keys work
  // across CT/PT/MR/US/CR/DX/MG/NM, each with its own (differently sized)
  // preset list, instead of only ever matching CT's ids. A modality with
  // fewer than 7 presets just leaves the higher-numbered keys with nothing
  // to select for that viewport.
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 0 },
    label: 'W/L Preset 1',
    keys: ['1'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 1 },
    label: 'W/L Preset 2',
    keys: ['2'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 2 },
    label: 'W/L Preset 3',
    keys: ['3'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 3 },
    label: 'W/L Preset 4',
    keys: ['4'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 4 },
    label: 'W/L Preset 5',
    keys: ['5'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 5 },
    label: 'W/L Preset 6',
    keys: ['6'],
  },
  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetIndex: 6 },
    label: 'W/L Preset 7',
    keys: ['7'],
  },
  {
    // RadiAnt: "Del: Delete selected ROI" - kept alongside the existing
    // backspace binding rather than replacing it.
    commandName: 'deleteActiveAnnotation',
    label: 'Delete Annotation',
    keys: ['backspace', 'del'],
  },
  {
    commandName: 'acceptPreview',
    label: 'Accept Preview',
    keys: ['enter'],
  },
  {
    // Aborts an in-progress annotation draw and/or rejects a pending
    // segmentation preview - whichever applies. Previously bound to a dead
    // 'cancelMeasurement' command name that was never implemented, and
    // separately shadowed by a duplicate 'rejectPreview' binding on the same
    // key; both are now handled by one real, working command.
    commandName: 'cancelMeasurementOrRejectPreview',
    label: 'Cancel / Reject Preview',
    keys: ['esc'],
  },
  {
    commandName: 'undo',
    label: 'Undo',
    keys: ['ctrl+z'],
    isEditable: true,
  },
  {
    commandName: 'redo',
    label: 'Redo',
    keys: ['ctrl+y'],
    isEditable: true,
  },
  {
    commandName: 'interpolateScrollForMarkerLabelmap',
    label: 'Interpolate Scroll',
    keys: ['n'],
    isEditable: true,
  },
  {
    commandName: 'increaseBrushSize',
    label: 'Increase Brush Size',
    keys: [']'],
    isEditable: true,
  },
  {
    commandName: 'decreaseBrushSize',
    label: 'Decrease Brush Size',
    keys: ['['],
    isEditable: true,
  },
  {
    // Moved off bare 'e' - that's now RadiAnt's Ellipse tool key (see below).
    commandName: 'setToolActive',
    commandOptions: { toolName: 'CircularEraser' },
    label: 'Eraser',
    keys: ['shift+e'],
    isEditable: true,
  },
  {
    // Moved off bare 'b' - that's now RadiAnt's series-browsing tool key
    // (StackScroll, see below).
    commandName: 'setToolActive',
    commandOptions: { toolName: 'CircularBrush' },
    label: 'Brush',
    keys: ['shift+b'],
    isEditable: true,
  },
  {
    // Moved off bare 'a' - that's now RadiAnt's Angle tool key (see below).
    commandName: 'addNewSegment',
    label: 'Add New Segment',
    keys: ['shift+a'],
    isEditable: true,
  },
  {
    // Works outside MPR too - switches to the MPR layout first if the
    // current series is reconstructable (see activateCrosshairsAnywhere).
    commandName: 'activateCrosshairsAnywhere',
    label: 'Crosshairs',
    keys: ['x'],
    isEditable: true,
  },
  {
    // RadiAnt-style "3D cursor" - a plain positioning crosshair (no MPR/
    // volumetric reconstruction). Also always available via Ctrl+Shift+Click
    // regardless of which tool this toggles onto the plain Primary button
    // (see the SimpleCrosshair binding in modes/basic/src/initToolGroups.ts).
    commandName: 'toggleToolActiveToolbar',
    commandOptions: {
      toolName: 'SimpleCrosshair',
      toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
    },
    label: '3D Cursor',
    keys: ['q'],
    isEditable: true,
  },
  {
    // RadiAnt: "Open TIC: Press Ctrl + Shift + E".
    commandName: 'generateTimeIntensityCurve',
    label: 'Time-Intensity Curve',
    keys: ['ctrl+shift+e'],
    isEditable: true,
  },
  {
    // RadiAnt: "Enable fusion: Click the Fusion button on the toolbar or
    // press Ctrl + Alt + F". This toggles PET onto the ACTIVE CT viewport
    // in place, preserving its exact camera state - previously bound to
    // 'setHangingProtocol'/'fusion', which switched the whole layout
    // instead of toggling an overlay (that dedicated compare-layout is
    // still reachable via the separate PetCtFusion toolbar button).
    commandName: 'toggleFusion',
    label: 'Fusion',
    keys: ['ctrl+alt+f'],
    isEditable: true,
  },
  // RadiAnt tool-activation letters (RadiAnt User Manual 2021.2, section 4.1
  // "2D Viewer window - global keyboard shortcuts"). B/W/M/Z select the
  // four "hand" tools, the rest select a measurement tool. Uses the same
  // plain 'setToolActive' pattern as the pre-existing Zoom/Eraser/Brush
  // bindings above (not toggleToolActiveToolbar) so these always select the
  // tool rather than toggling it back off.
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'StackScroll' },
    label: 'Browse (Scroll)',
    keys: ['b'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'WindowLevel' },
    label: 'Window/Level',
    keys: ['w'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Pan' },
    label: 'Pan',
    keys: ['m'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Length' },
    label: 'Length',
    keys: ['l'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'EllipticalROI' },
    label: 'Ellipse',
    keys: ['e'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Angle' },
    label: 'Angle',
    keys: ['a'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'CobbAngle' },
    label: 'Cobb Angle',
    keys: ['c'],
    isEditable: true,
  },
  {
    commandName: 'setToolActive',
    commandOptions: { toolName: 'ArrowAnnotate' },
    label: 'Arrow',
    keys: ['y'],
    isEditable: true,
  },
  {
    // Closest available Cornerstone3D equivalent of RadiAnt's node-based
    // "Closed polygon" tool (RadiAnt key: G).
    commandName: 'setToolActive',
    commandOptions: { toolName: 'SplineROI' },
    label: 'Closed Polygon',
    keys: ['g'],
    isEditable: true,
  },
  {
    // Closest available Cornerstone3D equivalent of RadiAnt's freehand
    // "Pencil" tool (RadiAnt key: P).
    commandName: 'setToolActive',
    commandOptions: { toolName: 'PlanarFreehandROI' },
    label: 'Pencil',
    keys: ['p'],
    isEditable: true,
  },
  {
    // RadiAnt exact - a custom DeviationTool now exists (see
    // extensions/cornerstone/src/tools/DeviationTool.ts), closing the gap
    // originally documented here as unbound.
    commandName: 'setToolActive',
    commandOptions: { toolName: 'Deviation' },
    label: 'Deviation',
    keys: ['d'],
    isEditable: true,
  },
  // Intentionally NOT bound - no real equivalent exists in this codebase's
  // Cornerstone3D tool set, and mapping onto an unrelated tool would
  // silently produce the wrong measurement:
  //  - RadiAnt 'O' Open polygon (open-path length measurement)
];

export default bindings;
