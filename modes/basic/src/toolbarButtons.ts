import type { Button } from '@ohif/core/types';

import { ViewportGridService } from '@ohif/core';
import i18n from 'i18next';

const callbacks = (toolName: string) => [
  {
    commandName: 'setViewportForToolConfiguration',
    commandOptions: {
      toolName,
    },
  },
];

export const setToolActiveToolbar = {
  commandName: 'setToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
  },
};

// Same as setToolActiveToolbar, but clicking the button again while its tool is
// already active deactivates it and reverts to the previously active tool
// (e.g. back to Window/Level or Stack Scroll), instead of just re-selecting it.
export const toggleToolActiveToolbar = {
  commandName: 'toggleToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
  },
};

// Same as toggleToolActiveToolbar, but for tools that own a mouse button with
// no natural "off" state (StackScroll owns the wheel + Primary, Zoom/Pan/
// TrackballRotate own their own button) - the very first toggle-off has no
// "previously active tool" to revert to yet, so fall back to WindowLevel
// instead of leaving that button bound to nothing.
export const toggleToolActiveToolbarWithFallback = {
  commandName: 'toggleToolActiveToolbar',
  commandOptions: {
    toolGroupIds: ['default', 'mpr', 'SRToolGroup', 'volume3d'],
    fallbackToolName: 'WindowLevel',
  },
};

const toolbarButtons: Button[] = [
  // sections
  {
    id: 'MeasurementTools',
    uiType: 'ohif.toolButtonList',
    props: {
      buttonSection: true,
    },
  },
  {
    id: 'AdvancedRenderingControls',
    uiType: 'ohif.advancedRenderingControls',
    props: {
      buttonSection: true,
    },
  },
  // visual dividers grouping the primary toolbar into clusters
  { id: 'divider1', uiType: 'ohif.divider', props: {} },
  { id: 'divider2', uiType: 'ohif.divider', props: {} },
  { id: 'divider3', uiType: 'ohif.divider', props: {} },
  { id: 'divider4', uiType: 'ohif.divider', props: {} },
  // tool defs
  {
    id: 'modalityLoadBadge',
    uiType: 'ohif.modalityLoadBadge',
    props: {
      icon: 'Status',
      label: i18n.t('Buttons:Status'),
      tooltip: i18n.t('Buttons:Status'),
      evaluate: {
        name: 'evaluate.modalityLoadBadge',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'navigationComponent',
    uiType: 'ohif.navigationComponent',
    props: {
      icon: 'Navigation',
      label: i18n.t('Buttons:Navigation'),
      tooltip: i18n.t('Buttons:Navigate between segments/measurements and manage their visibility'),
      evaluate: {
        name: 'evaluate.navigationComponent',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'trackingStatus',
    uiType: 'ohif.trackingStatus',
    props: {
      icon: 'TrackingStatus',
      label: i18n.t('Buttons:Tracking Status'),
      tooltip: i18n.t('Buttons:View and manage tracking status of measurements and annotations'),
      evaluate: {
        name: 'evaluate.trackingStatus',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'dataOverlayMenu',
    uiType: 'ohif.dataOverlayMenu',
    props: {
      icon: 'ViewportViews',
      label: i18n.t('Buttons:Data Overlay'),
      tooltip: i18n.t(
        'Buttons:Configure data overlay options and manage foreground/background display sets'
      ),
      evaluate: 'evaluate.dataOverlayMenu',
    },
  },
  {
    id: 'orientationMenu',
    uiType: 'ohif.orientationMenu',
    props: {
      icon: 'OrientationSwitch',
      label: i18n.t('Buttons:Orientation'),
      tooltip: i18n.t(
        'Buttons:Change viewport orientation between axial, sagittal, coronal and reformat planes'
      ),
      evaluate: {
        name: 'evaluate.orientationMenu',
        // hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'windowLevelMenuEmbedded',
    uiType: 'ohif.windowLevelMenuEmbedded',
    props: {
      icon: 'WindowLevel',
      label: i18n.t('Buttons:Window Level'),
      tooltip: i18n.t('Buttons:Adjust window/level presets and customize image contrast settings'),
      evaluate: {
        name: 'evaluate.windowLevelMenuEmbedded',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'windowLevelMenu',
    uiType: 'ohif.windowLevelMenu',
    props: {
      icon: 'WindowLevel',
      label: i18n.t('Buttons:Window Level'),
      tooltip: i18n.t('Buttons:Adjust window/level presets and customize image contrast settings'),
      evaluate: {
        name: 'evaluate.windowLevelMenu',
      },
    },
  },
  {
    id: 'voiManualControlMenu',
    uiType: 'ohif.voiManualControlMenu',
    props: {
      icon: 'WindowLevelAdvanced',
      label: i18n.t('Buttons:Advanced Window Level'),
      tooltip: i18n.t('Buttons:Advanced window/level settings with manual controls and presets'),
      evaluate: 'evaluate.voiManualControlMenu',
    },
  },
  {
    id: 'thresholdMenu',
    uiType: 'ohif.thresholdMenu',
    props: {
      icon: 'Threshold',
      label: i18n.t('Buttons:Threshold'),
      tooltip: i18n.t('Buttons:Image threshold settings'),
      evaluate: {
        name: 'evaluate.thresholdMenu',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'opacityMenu',
    uiType: 'ohif.opacityMenu',
    props: {
      icon: 'Opacity',
      label: i18n.t('Buttons:Opacity'),
      tooltip: i18n.t('Buttons:Image opacity settings'),
      evaluate: {
        name: 'evaluate.opacityMenu',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'slabThicknessMenu',
    uiType: 'ohif.slabThicknessMenu',
    props: {
      icon: 'GroupLayers',
      label: i18n.t('Buttons:Slab Thickness'),
      tooltip: i18n.t('Buttons:Thick/thin slice (slab thickness) and MIP/MinIP blend mode'),
      evaluate: {
        name: 'evaluate.slabThicknessMenu',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'Colorbar',
    uiType: 'ohif.colorbar',
    props: {
      type: 'tool',
      label: i18n.t('Buttons:Colorbar'),
    },
  },
  {
    id: 'Reset',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-reset',
      label: i18n.t('Buttons:Reset View'),
      tooltip: i18n.t('Buttons:Reset View'),
      commands: 'resetViewport',
      evaluate: 'evaluate.action',
    },
  },
  {
    // RadiAnt: "Fit image into panel" (Ctrl+0). Was previously only reachable
    // via the fitViewportToWindow hotkey ('='), with no toolbar button.
    id: 'FitToWindow',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-expand',
      label: i18n.t('Buttons:Fit to Window'),
      tooltip: i18n.t('Buttons:Fit to Window'),
      commands: 'fitViewportToWindow',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    // RadiAnt: "Clear transformation" (Ctrl+Shift+\) - rotation/flip only,
    // distinct from the full Reset button above.
    id: 'ClearTransformations',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-clear',
      label: i18n.t('Buttons:Clear Transformations'),
      tooltip: i18n.t('Buttons:Clear Transformations (rotation/flip only)'),
      commands: 'clearViewportTransformations',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'rotate-right',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rotate-right',
      label: i18n.t('Buttons:Rotate Right'),
      tooltip: i18n.t('Buttons:Rotate +90'),
      commands: 'rotateViewportCW',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    // RadiAnt Features list: "Rotate (90 CW, 90 CCW, 180)".
    id: 'rotate-180',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rotate-right',
      label: i18n.t('Buttons:Rotate 180'),
      tooltip: i18n.t('Buttons:Rotate 180°'),
      commands: 'rotateViewport180',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'flipHorizontal',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-flip-horizontal',
      label: i18n.t('Buttons:Flip Horizontal'),
      tooltip: i18n.t('Buttons:Flip Horizontally'),
      commands: 'flipViewportHorizontal',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ImageSliceSync',
    uiType: 'ohif.toolButton',
    props: {
      // Distinct from ImageIndexSync/ZoomPanSync below - was the same
      // plain 'link' icon on all three, making the three sync toggles
      // visually indistinguishable from each other on the toolbar.
      icon: 'tool-stack-image-sync',
      label: i18n.t('Buttons:Auto Sync'),
      tooltip: i18n.t(
        'Buttons:Auto sync - keeps viewports aligned by 3D position as you scroll'
      ),
      commands: {
        commandName: 'toggleSynchronizerExclusive',
        commandOptions: {
          type: 'imageSlice',
          syncId: 'IMAGE_SLICE_SYNC',
          otherType: 'imageIndex',
          otherSyncId: 'IMAGE_INDEX_SYNC',
        },
      },
      // NOTE: EVENTS.VIEWPORT_NEW_IMAGE_SET (from @cornerstonejs/core) was
      // tried here first, but extensions/default/src/init.ts's listener
      // wiring only subscribes through viewportGridService's own pub-sub,
      // which never receives cornerstone3D's core events - that listener
      // was silently never firing. viewportGridService.EVENTS.VIEWPORTS_READY
      // is one it actually supports, and fires whenever the grid's
      // viewports change and finish loading (new study, a pane added via
      // ctrl+click, layout switch, etc.) - exactly when a default needs
      // re-applying.
      listeners: {
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: {
          commandName: 'ensureDefaultSyncOnViewportsReady',
        },
      },
      evaluate: [
        'evaluate.cornerstone.synchronizer',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ImageIndexSync',
    uiType: 'ohif.toolButton',
    props: {
      // 'icon-link' turned out to be the exact same underlying icon
      // component as the plain 'link' ZoomPanSync uses below (verified
      // against the icon registry, not just the string name). "Manual"
      // sync keeps viewports on the same plain image number/slice - the
      // jump-to-slice icon is a meaningful match for that, not just a
      // visually-distinct placeholder.
      icon: 'JumpToSlice',
      label: i18n.t('Buttons:Manual Sync'),
      tooltip: i18n.t(
        'Buttons:Manual sync - keeps viewports on the same plain image number as you scroll, ignoring 3D position'
      ),
      commands: {
        commandName: 'toggleSynchronizerExclusive',
        commandOptions: {
          type: 'imageIndex',
          syncId: 'IMAGE_INDEX_SYNC',
          otherType: 'imageSlice',
          otherSyncId: 'IMAGE_SLICE_SYNC',
        },
      },
      evaluate: [
        'evaluate.cornerstone.synchronizer',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ZoomPanSync',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'link',
      label: i18n.t('Buttons:Zoom/Pan Sync'),
      tooltip: i18n.t(
        'Buttons:Zoom/Pan sync - zooming or panning one viewport applies to every open viewport. On by default with more than one viewport open.'
      ),
      commands: {
        commandName: 'toggleZoomPanSync',
        commandOptions: {
          type: 'zoompan',
          syncId: 'ZOOMPAN_SYNC',
        },
      },
      // Same VIEWPORTS_READY wiring as ImageSliceSync above - re-applies
      // the "on by default" state whenever the grid changes (new study, a
      // pane added via ctrl+click, layout switch), without fighting a
      // choice the doctor already made explicitly.
      listeners: {
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: {
          commandName: 'ensureDefaultSyncOnViewportsReady',
        },
      },
      evaluate: [
        'evaluate.cornerstone.synchronizer',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'volume3d'],
        },
      ],
    },
  },
  {
    id: 'ReferenceLines',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-referenceLines',
      label: i18n.t('Buttons:Reference Lines'),
      tooltip: i18n.t('Buttons:Show Reference Lines'),
      commands: 'toggleEnabledDisabledToolbar',
      listeners: {
        [ViewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED]: callbacks('ReferenceLines'),
        [ViewportGridService.EVENTS.VIEWPORTS_READY]: callbacks('ReferenceLines'),
      },
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'ImageOverlayViewer',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'toggle-dicom-overlay',
      label: i18n.t('Buttons:Image Overlay'),
      tooltip: i18n.t('Buttons:Toggle Image Overlay'),
      commands: 'toggleEnabledDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'StackScroll',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-stack-scroll',
      label: i18n.t('Buttons:Stack Scroll'),
      tooltip: i18n.t('Buttons:Stack Scroll'),
      commands: toggleToolActiveToolbarWithFallback,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'invert',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-invert',
      label: i18n.t('Buttons:Invert'),
      tooltip: i18n.t('Buttons:Invert Colors'),
      commands: 'invertViewport',
      evaluate: [
        'evaluate.viewportProperties.toggle',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Probe',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-probe',
      label: i18n.t('Buttons:Probe'),
      tooltip: i18n.t('Buttons:Probe'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Cine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-cine',
      label: i18n.t('Buttons:Cine'),
      tooltip: i18n.t('Buttons:Cine'),
      commands: 'toggleCine',
      evaluate: [
        'evaluate.cine',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['volume3d'],
        },
      ],
    },
  },
  {
    id: 'Angle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-angle',
      label: i18n.t('Buttons:Angle'),
      tooltip: i18n.t('Buttons:Angle'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CobbAngle',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-cobb-angle',
      label: i18n.t('Buttons:Cobb Angle'),
      tooltip: i18n.t('Buttons:Cobb Angle'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Magnify',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-magnify',
      label: i18n.t('Buttons:Zoom-in'),
      tooltip: i18n.t('Buttons:Zoom-in'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'CalibrationLine',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-calibration',
      label: i18n.t('Buttons:Calibration'),
      tooltip: i18n.t('Buttons:Calibration Line'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    // RadiAnt: Deviation tool (User Manual v2021.2 sec. 2.7.7) - shows the
    // perpendicular distance and angle of a segment relative to whichever
    // axis (horizontal/vertical) it's closer to.
    id: 'Deviation',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-length',
      label: i18n.t('Buttons:Deviation'),
      tooltip: i18n.t('Buttons:Deviation Tool'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'TagBrowser',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'dicom-tag-browser',
      label: i18n.t('Buttons:Dicom Tag Browser'),
      tooltip: i18n.t('Buttons:Dicom Tag Browser'),
      commands: 'openDICOMTagViewer',
    },
  },
  {
    id: 'AdvancedMagnify',
    uiType: 'ohif.toolButton',
    props: {
      // 'icon-tool-loupe' turned out to be the exact same underlying icon
      // component as 'tool-magnify' (the plain Magnify/Zoom-in tool above) -
      // genuinely switching to a different magnify glyph.
      icon: 'tool-quick-magnify',
      label: i18n.t('Buttons:Magnify Probe'),
      tooltip: i18n.t('Buttons:Magnify Probe'),
      commands: 'toggleActiveDisabledToolbar',
      evaluate: [
        'evaluate.cornerstoneTool.toggle.ifStrictlyDisabled',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'UltrasoundDirectionalTool',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-ultrasound-bidirectional',
      label: i18n.t('Buttons:Ultrasound Directional'),
      tooltip: i18n.t('Buttons:Ultrasound Directional'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.modality.supported',
          supportedModalities: ['US'],
        },
      ],
    },
  },
  {
    id: 'WindowLevelRegion',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-window-region',
      label: i18n.t('Buttons:Window Level Region'),
      tooltip: i18n.t('Buttons:Window Level Region'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'Length',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-length',
      label: i18n.t('Buttons:Length'),
      tooltip: i18n.t('Buttons:Length Tool'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Bidirectional',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-bidirectional',
      label: i18n.t('Buttons:Bidirectional'),
      tooltip: i18n.t('Buttons:Bidirectional Tool'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'ArrowAnnotate',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-annotate',
      label: i18n.t('Buttons:Annotation'),
      tooltip: i18n.t('Buttons:Arrow Annotate'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'EllipticalROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-ellipse',
      label: i18n.t('Buttons:Ellipse'),
      tooltip: i18n.t('Buttons:Ellipse ROI'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'RectangleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-rectangle',
      label: i18n.t('Buttons:Rectangle'),
      tooltip: i18n.t('Buttons:Rectangle ROI'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'CircleROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-circle',
      label: i18n.t('Buttons:Circle'),
      tooltip: i18n.t('Buttons:Circle Tool'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'PlanarFreehandROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-freehand-roi',
      label: i18n.t('Buttons:Freehand ROI'),
      tooltip: i18n.t('Buttons:Freehand ROI'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'SplineROI',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-spline-roi',
      label: i18n.t('Buttons:Spline ROI'),
      tooltip: i18n.t('Buttons:Spline ROI'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'LivewireContour',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'icon-tool-livewire',
      label: i18n.t('Buttons:Livewire tool'),
      tooltip: i18n.t('Buttons:Livewire tool'),
      commands: toggleToolActiveToolbar,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  // Window Level
  {
    id: 'WindowLevel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-window-level',
      label: i18n.t('Buttons:Window Level'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'Pan',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-move',
      label: i18n.t('Buttons:Pan'),
      commands: toggleToolActiveToolbarWithFallback,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Zoom',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-zoom',
      label: i18n.t('Buttons:Zoom'),
      commands: toggleToolActiveToolbarWithFallback,
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'TrackballRotate',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-3d-rotate',
      label: i18n.t('Buttons:3D Rotate'),
      commands: toggleToolActiveToolbarWithFallback,
      evaluate: {
        name: 'evaluate.cornerstoneTool',
        disabledText: i18n.t('Buttons:Select a 3D viewport to enable this tool'),
      },
    },
  },
  {
    id: 'Capture',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-capture',
      label: i18n.t('Buttons:Capture'),
      commands: 'showDownloadViewportModal',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'wholeSlide'],
        },
      ],
    },
  },
  {
    id: 'TimeIntensityCurve',
    uiType: 'ohif.toolButton',
    props: {
      // No chart/curve icon existed anywhere in this app's icon set for
      // this - hand-built one (extensions/../Icons/Sources/
      // TimeIntensityCurve.tsx): axes plus a rising polyline with data
      // points, matching what the feature actually plots.
      icon: 'TimeIntensityCurve',
      label: i18n.t('Buttons:Time-Intensity Curve'),
      tooltip: i18n.t(
        'Buttons:Plot signal intensity at the 3D Cursor point across a perfusion/DCE series\' time phases'
      ),
      commands: 'generateTimeIntensityCurve',
      evaluate: [
        'evaluate.action',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video', 'wholeSlide'],
        },
        {
          // RadiAnt's own TIC documentation/support responses restrict it to
          // studies "where spatial position is clearly defined, such as CT
          // and MR" - explicitly NOT contrast-enhanced ultrasound or other
          // modalities. Matching that scope here avoids generating a
          // misleading "curve" on modalities where phase/instance ordering
          // doesn't represent a real time axis (X-ray, mammography, DWI
          // b-value series, etc.).
          name: 'evaluate.modality.supported',
          supportedModalities: ['CT', 'MR'],
          disabledText: i18n.t(
            'Buttons:Time-Intensity Curve is only available for CT and MR series'
          ),
        },
      ],
    },
  },
  {
    // Direct one-click access, not buried inside the Layout dropdown -
    // matches RadiAnt, where switching to a fusion view is a single
    // top-bar button rather than a menu the doctor has to open first.
    id: 'PetCtFusion',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'layout-advanced-mpr',
      label: i18n.t('Buttons:PET/CT Fusion'),
      tooltip: i18n.t('Buttons:Switch to the PET/CT Fusion view'),
      commands: {
        commandName: 'setHangingProtocol',
        commandOptions: {
          protocolId: 'fusion',
        },
      },
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'Layout',
    uiType: 'ohif.layoutSelector',
    props: {
      rows: 3,
      columns: 4,
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'MouseBindingsMenu',
    uiType: 'ohif.mouseBindingsMenu',
    props: {
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'Crosshairs',
    uiType: 'ohif.toolButton',
    props: {
      type: 'tool',
      icon: 'tool-crosshair',
      label: i18n.t('Buttons:Crosshairs'),
      tooltip: i18n.t('Buttons:Click to toggle on or off'),
      // Works on any reconstructable series, not just while already viewing
      // the MPR layout - switches to MPR automatically if needed.
      commands: {
        commandName: 'activateCrosshairsAnywhere',
      },
      evaluate: {
        name: 'evaluate.cornerstoneTool.toggleWithModifier',
        disabledText: i18n.t('Buttons:Select a reconstructable series to enable this tool'),
        toggledOnIcon: 'tool-crosshair-checked',
        defaultIcon: 'tool-crosshair',
      },
    },
  },
  {
    // RadiAnt-style simple crosshair: click (or click-drag) anywhere on the
    // current image to place a positioning crosshair - a plain visual aid,
    // not the MPR Crosshairs tool's volumetric 3-plane reconstruction, and
    // works on any single image (not just reconstructable series).
    id: 'SimpleCrosshair',
    uiType: 'ohif.toolButton',
    props: {
      // Distinct from the real volumetric Crosshairs tool above, which was
      // using this exact same plain-outline icon - this is a different
      // marked/filled variant of the crosshair glyph.
      icon: 'tool-crosshair-checked',
      label: i18n.t('Buttons:Simple Crosshair'),
      tooltip: i18n.t('Buttons:Click to place a crosshair on the current image'),
      commands: toggleToolActiveToolbar,
      evaluate: [
        'evaluate.cornerstoneTool',
        {
          name: 'evaluate.viewport.supported',
          unsupportedViewportTypes: ['video'],
        },
      ],
    },
  },
  {
    id: 'SegmentLabelTool',
    uiType: 'ohif.toolBoxButton',
    props: {
      icon: 'tool-segment-label',
      label: i18n.t('Buttons:Segment Label Display'),
      tooltip: i18n.t(
        'Buttons:Click to show or hide segment labels when hovering with your mouse.'
      ),
      commands: { commandName: 'toggleSegmentLabel' },
      evaluate: [
        'evaluate.cornerstoneTool.toggle',
        {
          name: 'evaluate.cornerstone.hasSegmentation',
        },
      ],
    },
  },
  {
    id: 'closeViewportButton',
    uiType: 'ohif.toolButton',
    props: {
      type: 'action',
      icon: 'Close',
      label: i18n.t('Buttons:Close'),
      tooltip: i18n.t('Buttons:Close this viewport'),
      commands: { commandName: 'closeViewport' },
      evaluate: {
        name: 'evaluate.viewportGrid.canClose',
        hideWhenDisabled: true,
      },
    },
  },
  {
    id: 'PopoutCurrentView',
    uiType: 'ohif.toolButton',
    props: {
      type: 'action',
      icon: 'external-link',
      label: i18n.t('Buttons:Full Window'),
      tooltip: i18n.t(
        'Buttons:Open this view in its own chrome-less window - handy for reporting'
      ),
      commands: { commandName: 'popoutCurrentView' },
      evaluate: 'evaluate.action',
    },
  },
  // {
  //   id: 'Undo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'prev-arrow',
  //     label: 'Undo',
  //     commands: {
  //       commandName: 'undo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
  // {
  //   id: 'Redo',
  //   uiType: 'ohif.toolButton',
  //   props: {
  //     type: 'tool',
  //     icon: 'next-arrow',
  //     label: 'Redo',
  //     commands: {
  //       commandName: 'redo',
  //     },
  //     evaluate: 'evaluate.action',
  //   },
  // },
];

export default toolbarButtons;
