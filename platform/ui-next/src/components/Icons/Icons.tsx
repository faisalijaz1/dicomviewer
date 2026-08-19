import React from 'react';
import Actions from './Sources/Actions';
import Add from './Sources/Add';
import Cancel from './Sources/Cancel';
import ChevronClosed from './Sources/ChevronClosed';
import ChevronOpen from './Sources/ChevronOpen';
import Code from './Sources/Code';
import ColorChange from './Sources/ColorChange';
import Controls from './Sources/Controls';
import Copy from './Sources/Copy';
import Delete from './Sources/Delete';
import DicomTagBrowser from './Sources/DicomTagBrowser';
import DisplayFillAndOutline from './Sources/DisplayFillAndOutline';
import DisplayFillOnly from './Sources/DisplayFillOnly';
import DisplayOutlineOnly from './Sources/DisplayOutlineOnly';
import Download from './Sources/Download';
import Export from './Sources/Export';
import EyeHidden from './Sources/EyeHidden';
import EyeVisible from './Sources/EyeVisible';
import FeedbackComplete from './Sources/FeedbackComplete';
import GearSettings from './Sources/GearSettings';
import Hide from './Sources/Hide';
import IconMPR from './Sources/IconMPR';
import Info from './Sources/Info';
import InfoLink from './Sources/InfoLink';
import InfoSeries from './Sources/InfoSeries';
import JumpToSlice from './Sources/JumpToSlice';
import TimeIntensityCurveIcon from './Sources/TimeIntensityCurve';
import {
  RadiantLayoutAdvanced3DFourUp,
  RadiantLayoutAdvanced3DMain,
  RadiantLayoutAdvanced3DOnly,
  RadiantLayoutAdvanced3DPrimary,
  RadiantLayoutAdvancedAxialPrimary,
  RadiantCoronal,
  RadiantFrameView,
  RadiantMPR,
  RadiantPetCtFusion,
  RadiantSagittal,
  RadiantTool3DRotate,
  RadiantCine,
  RadiantClearTransformations,
  RadiantFitToWindow,
  RadiantFlipHorizontal,
  RadiantInvert,
  RadiantPan,
  RadiantResetView,
  RadiantRotate180,
  RadiantRotateRight90,
  RadiantStackScroll,
  RadiantWindowLevel,
  RadiantZoom,
  RadiantSplineRoi,
  RadiantAngle,
  RadiantBidirectional,
  RadiantCircleRoi,
  RadiantEllipseRoi,
  RadiantFreehandRoi,
  RadiantLength,
  RadiantLivewire,
  RadiantRectangleRoi,
} from './Sources/RadiantIcons';
import {
  ProVolumeRendering,
  ProCheck,
  ProToggleDicomOverlay,
  ProTool3DRotate,
  ProToolAngle,
  ProToolBidirectional,
  ProToolFlipHorizontal,
  ProToolMagnify,
  ProToolMove,
  ProToolProbe,
  ProToolWindowLevel,
  ProArrowLeft,
  ProChevronRight,
  ProChevronUp,
  ProChevronDown,
  ProCloseX,
  ProCaretSort,
  ProDotFilled,
  ProIconToolCobbAngle,
  ProIconToolFreehandRoi,
  ProIconToolWindowRegion,
  ProLayoutAdvanced3DMain,
  ProLayoutAdvancedSagittal,
  ProLayoutAdvancedCoronal,
  ProLayoutAdvancedMPR,
  ProLayoutAdvancedAxialPrimary,
  ProLayoutAdvancedFusion,
  ProLayout1x1,
  ProLayout1x2,
  ProLayout2x2,
  ProLayout2x3,
  ProNavigation,
  ProToolCapture,
  ProToolCrosshair,
  ProToolInvert,
  ProToolLength,
  ProToolRectangle,
  ProToolSegmentLabel,
  ProToolStackImageSync,
  ProToolZoom,
  ProIconToolSplineRoi,
  ProIconToolUltrasoundBidirectional,
  ProLayoutAdvanced3DFourUp,
  ProStatus,
  ProToolAnnotate,
  ProToolCalibration,
  ProToolCine,
  ProToolReset,
  ProToolRotate180,
  ProToolStackScroll,
  ProIconClear,
  ProIconToolLivewire,
  ProLayoutAdvanced3DOnly,
  ProLayoutAdvanced3DPrimary,
  ProLayoutAdvancedFrameView,
  ProToolCircle,
  ProToolCrosshairChecked,
  ProToolEllipse,
  ProToolLayout,
  ProToolQuickMagnify,
  ProToolReferenceLines,
  ProToolRotateRight,
  ProIconToolExpand,
} from './Sources/ProIcons';
import ListView from './Sources/ListView';
import LoadingSpinner from './Sources/LoadingSpinner';
import Lock from './Sources/Lock';
import Minus from './Sources/Minus';
import MissingIcon from './Sources/MissingIcon';
import More from './Sources/More';
import MultiplePatients from './Sources/MultiplePatients';
import NavigationPanelReveal from './Sources/NavigationPanelReveal';
import OHIFLogo from './Sources/OHIFLogo';
import Patient from './Sources/Patient';
import Pin from './Sources/Pin';
import PinFill from './Sources/PinFill';
import Plus from './Sources/Plus';
import PowerOff from './Sources/PowerOff';
import Redo from './Sources/Redo';
import Refresh from './Sources/Refresh';
import Rename from './Sources/Rename';
import Series from './Sources/Series';
import Settings from './Sources/Settings';
import Show from './Sources/Show';
import SidePanelCloseLeft from './Sources/SidePanelCloseLeft';
import SidePanelCloseRight from './Sources/SidePanelCloseRight';
import SortingAscending from './Sources/SortingAscending';
import SocialGithub from './Sources/SocialGithub';
import SortingDescending from './Sources/SortingDescending';
import StatusError from './Sources/StatusError';
import StatusSuccess from './Sources/StatusSuccess';
import StatusTracking from './Sources/StatusTracking';
import StatusUntracked from './Sources/StatusUntracked';
import StatusWarning from './Sources/StatusWarning';
import Tab4D from './Sources/Tab4D';
import TabLinear from './Sources/TabLinear';
import TabPatientInfo from './Sources/TabPatientInfo';
import TabRoiThreshold from './Sources/TabRoiThreshold';
import TabSegmentation from './Sources/TabSegmentation';
import TabStudies from './Sources/TabStudies';
import ThumbnailView from './Sources/ThumbnailView';
import Trash from './Sources/Trash';
import ViewportViews from './Sources/ViewportViews';
import Sorting from './Sources/Sorting';
import Upload from './Sources/Upload';
import LaunchArrow from './Sources/LaunchArrow';
import LaunchInfo from './Sources/LaunchInfo';
import GroupLayers from './Sources/GroupLayers';
import Database from './Sources/Database';
import InvestigationalUse from './Sources/InvestigationalUse';
import IconTransferring from './Sources/IconTransferring';
import Alert from './Sources/Alert';
import AlertOutline from './Sources/AlertOutline';
import Clipboard from './Sources/Clipboard';
import Checked from './Sources/Checked';
import OrientationSwitch from './Sources/OrientationSwitch';
import OrientationSwitchA from './Sources/OrientationSwitchA';
import OrientationSwitchS from './Sources/OrientationSwitchS';
import OrientationSwitchC from './Sources/OrientationSwitchC';
import OrientationSwitchR from './Sources/OrientationSwitchR';
import LayerBackground from './Sources/LayerBackground';
import LayerForeground from './Sources/LayerForeground';
import LayerSegmentation from './Sources/LayerSegmentation';
import WindowLevelAdvanced from './Sources/WindowLevelAdvanced';
import Opacity from './Sources/Opacity';
import Threshold from './Sources/Threshold';
import {
  Tool3DRotate,
  ToolAngle,
  ToolAnnotate,
  ToolBidirectional,
  ToolCalibrate,
  ToolCapture,
  ToolCine,
  ToolCircle,
  ToolCobbAngle,
  ToolCreateThreshold,
  ToolCrosshair,
  ToolCrosshairChecked,
  ToolDicomTagBrowser,
  ToolFlipHorizontal,
  ToolFreehandPolygon,
  ToolFreehandRoi,
  ToolFreehand,
  ToolFusionColor,
  ToolInvert,
  ToolLayoutDefault,
  ToolLength,
  ToolMagneticRoi,
  ToolMagnify,
  ToolMeasureEllipse,
  ToolMoreMenu,
  ToolMove,
  ToolPolygon,
  ToolQuickMagnify,
  ToolRectangle,
  ToolReferenceLines,
  ToolReset,
  ToolRotateRight,
  ToolSegBrush,
  ToolSegEraser,
  ToolSegShape,
  ToolSegThreshold,
  ToolSplineRoi,
  ToolStackImageSync,
  ToolStackScroll,
  ToolToggleDicomOverlay,
  ToolUltrasoundBidirectional,
  ToolWindowLevel,
  ToolWindowRegion,
  ToolZoom,
  ToolLayout,
  ToolProbe,
  ToolEraser,
  ToolBrush,
  ToolThreshold,
  ToolShape,
  ToolLabelmapAssist,
  ToolPETSegment,
  ToolInterpolation,
  ToolBidirectionalSegment,
  ToolSegmentAnything,
  ToolContract,
  ToolExpand,
  ToolClickSegment,
  ToolSegmentLabel,
  ToolSculptor,
  ToolLabelmapEditWithContour,
} from './Sources/Tools';
import ActionNewDialog from './Sources/ActionNewDialog';
import NotificationInfo from './Sources/NotificationInfo';
import StatusLocked from './Sources/StatusLocked';
import ContentPrev from './Sources/ContentPrev';
import ContentNext from './Sources/ContentNext';
import CheckBoxChecked from './Sources/CheckBoxChecked';
import CheckBoxUnchecked from './Sources/CheckBoxUnChecked';
import Close from './Sources/Close';
import Pause from './Sources/Pause';
import Play from './Sources/Play';
import ViewportWindowLevel from './Sources/ViewportWindowLevel';
import Search from './Sources/Search';
import Clear from './Sources/Clear';
import {
  LayoutAdvanced3DOnly,
  LayoutAdvanced3DPrimary,
  LayoutAdvancedAxialPrimary,
  LayoutAdvancedMPR,
  LayoutCommon2x2,
  LayoutCommon1x1,
  LayoutCommon1x2,
  LayoutCommon2x3,
  LayoutAdvanced3DFourUp,
  LayoutAdvanced3DMain,
} from './Sources/Layout';
import {
  ActionsSmooth,
  ActionsSimplify,
  ActionsCombine,
  ActionsCombineMerge,
  ActionsCombineSubtract,
  ActionsCombineIntersect,
  ActionsSetting,
  ActionsBidirectional,
  ActionsInterpolate,
} from './Sources/SegActions';
import {
  HelperCombineSubtract,
  HelperCombineIntersect,
  HelperCombineMerge,
} from './Sources/Helpers';
import Link from './Sources/Link';
import IconColorLUT from './Sources/IconColorLUT';
import CTAAA from '../../../assets/images/CT-AAA.png';
import CTAAA2 from '../../../assets/images/CT-AAA2.png';
import CTAir from '../../../assets/images/CT-Air.png';
import CTBone from '../../../assets/images/CT-Bone.png';
import CTBones from '../../../assets/images/CT-Bones.png';
import CTCardiac from '../../../assets/images/CT-Cardiac.png';
import CTCardiac2 from '../../../assets/images/CT-Cardiac2.png';
import CTCardiac3 from '../../../assets/images/CT-Cardiac3.png';
import CTChestContrastEnhanced from '../../../assets/images/CT-Chest-Contrast-Enhanced.png';
import CTChestVessels from '../../../assets/images/CT-Chest-Vessels.png';
import CTCoronaryArteries from '../../../assets/images/CT-Coronary-Arteries.png';
import CTCoronaryArteries2 from '../../../assets/images/CT-Coronary-Arteries-2.png';
import CTCoronaryArteries3 from '../../../assets/images/CT-Coronary-Arteries-3.png';
import CTCroppedVolumeBone from '../../../assets/images/CT-Cropped-Volume-Bone.png';
import CTFat from '../../../assets/images/CT-Fat.png';
import CTLiverVasculature from '../../../assets/images/CT-Liver-Vasculature.png';
import CTLung from '../../../assets/images/CT-Lung.png';
import CTMIP from '../../../assets/images/CT-MIP.png';
import CTMuscle from '../../../assets/images/CT-Muscle.png';
import CTPulmonaryArteries from '../../../assets/images/CT-Pulmonary-Arteries.png';
import CTSoftTissue from '../../../assets/images/CT-Soft-Tissue.png';
import DTIFABrain from '../../../assets/images/DTI-FA-Brain.png';
import MRAngio from '../../../assets/images/MR-Angio.png';
import MRDefault from '../../../assets/images/MR-Default.png';
import MRMIP from '../../../assets/images/MR-MIP.png';
import MRT2Brain from '../../../assets/images/MR-T2-Brain.png';
import ExternalLink from './Sources/ExternalLink';
import OHIFLogoColorDarkBackground from './Sources/OHIFLogoColorDarkBackground';
import Magnifier from './Sources/Magnifier';
import LoadingOHIFMark from './Sources/LoadingOHIFMark';
import ArrowLeftBold from './Sources/ArrowLeftBold';
import Pencil from './Sources/Pencil';
import NotificationWarning from './Sources/NotificationWarning';
import ArrowRight from './Sources/ArrowRight';
import ChevronLeft from './Sources/ChevronLeft';
import StatusAlert from './Sources/StatusAlert';
import Undo from './Sources/Undo';
import TabContours from './Sources/TabContours';
import IllustrationNotFound from './Sources/IllustrationNotFound';
//
//
type IconProps = React.HTMLAttributes<SVGElement>;
type ImageIconProps = React.ImgHTMLAttributes<HTMLImageElement>;

const ImageWrapper = ({ src, ...props }: { src: string } & ImageIconProps) => {
  return (
    <img
      src={src}
      {...props}
      alt=""
    />
  );
};

export const Icons = {
  'CT-AAA': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTAAA}
      {...props}
    />
  ),
  'CT-AAA2': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTAAA2}
      {...props}
    />
  ),
  'CT-Air': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTAir}
      {...props}
    />
  ),
  'CT-Bone': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTBone}
      {...props}
    />
  ),
  'CT-Bones': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTBones}
      {...props}
    />
  ),
  'CT-Cardiac': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCardiac}
      {...props}
    />
  ),
  'CT-Cardiac2': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCardiac2}
      {...props}
    />
  ),
  'CT-Cardiac3': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCardiac3}
      {...props}
    />
  ),
  'CT-Chest-Contrast-Enhanced': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTChestContrastEnhanced}
      {...props}
    />
  ),
  'CT-Chest-Vessels': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTChestVessels}
      {...props}
    />
  ),
  'CT-Coronary-Arteries': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCoronaryArteries}
      {...props}
    />
  ),
  'CT-Coronary-Arteries-2': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCoronaryArteries2}
      {...props}
    />
  ),
  'CT-Coronary-Arteries-3': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCoronaryArteries3}
      {...props}
    />
  ),
  'CT-Cropped-Volume-Bone': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTCroppedVolumeBone}
      {...props}
    />
  ),
  'CT-Fat': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTFat}
      {...props}
    />
  ),
  'CT-Liver-Vasculature': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTLiverVasculature}
      {...props}
    />
  ),
  'CT-Lung': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTLung}
      {...props}
    />
  ),
  'CT-MIP': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTMIP}
      {...props}
    />
  ),
  'CT-Muscle': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTMuscle}
      {...props}
    />
  ),
  'CT-Pulmonary-Arteries': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTPulmonaryArteries}
      {...props}
    />
  ),
  'CT-Soft-Tissue': (props: ImageIconProps) => (
    <ImageWrapper
      src={CTSoftTissue}
      {...props}
    />
  ),
  'DTI-FA-Brain': (props: ImageIconProps) => (
    <ImageWrapper
      src={DTIFABrain}
      {...props}
    />
  ),
  'MR-Angio': (props: ImageIconProps) => (
    <ImageWrapper
      src={MRAngio}
      {...props}
    />
  ),
  'MR-Default': (props: ImageIconProps) => (
    <ImageWrapper
      src={MRDefault}
      {...props}
    />
  ),
  'MR-MIP': (props: ImageIconProps) => (
    <ImageWrapper
      src={MRMIP}
      {...props}
    />
  ),
  'MR-T2-Brain': (props: ImageIconProps) => (
    <ImageWrapper
      src={MRT2Brain}
      {...props}
    />
  ),
  VolumeRendering: (props: IconProps) => ProVolumeRendering(props),
  // Icons
  LayerBackground,
  LayerForeground,
  LayerSegmentation,
  OrientationSwitch,
  OrientationSwitchA,
  OrientationSwitchS,
  OrientationSwitchC,
  OrientationSwitchR,
  Checked,
  Clipboard,
  ActionNewDialog,
  GroupLayers,
  Database,
  InvestigationalUse,
  Tool3DRotate,
  ToolAngle,
  ToolAnnotate,
  ToolBidirectional,
  ToolCalibrate,
  ToolCapture,
  ToolCine,
  ToolCircle,
  ToolCobbAngle,
  ToolCreateThreshold,
  ToolCrosshair,
  ToolCrosshairChecked,
  ToolDicomTagBrowser,
  ToolFlipHorizontal,
  ToolFreehandPolygon,
  ToolFreehandRoi,
  ToolFreehand,
  ToolFusionColor,
  ToolInvert,
  ToolLayoutDefault,
  ToolLength,
  ToolMagneticRoi,
  ToolMagnify,
  ToolMeasureEllipse,
  ToolMoreMenu,
  ToolMove,
  ToolPolygon,
  ToolQuickMagnify,
  ToolRectangle,
  ToolReferenceLines,
  ToolReset,
  ToolRotateRight,
  ToolSegBrush,
  ToolSegEraser,
  ToolSegShape,
  ToolSegThreshold,
  ToolSplineRoi,
  ToolStackImageSync,
  ToolStackScroll,
  ToolToggleDicomOverlay,
  ToolUltrasoundBidirectional,
  ToolWindowLevel,
  ToolWindowRegion,
  ToolZoom,
  LaunchArrow,
  LaunchInfo,
  Upload,
  Actions,
  Add,
  Cancel,
  Code,
  ColorChange,
  Controls,
  Copy,
  Delete,
  DicomTagBrowser,
  DisplayFillAndOutline,
  DisplayFillOnly,
  DisplayOutlineOnly,
  FillAndOutline: DisplayFillAndOutline,
  FillOnly: DisplayFillOnly,
  OutlineOnly: DisplayOutlineOnly,
  Download,
  Export,
  EyeHidden,
  EyeVisible,
  FeedbackComplete,
  GearSettings,
  Hide,
  IconMPR,
  Info,
  InfoLink,
  InfoSeries,
  ListView,
  LoadingSpinner,
  Lock,
  Minus,
  MissingIcon,
  More,
  MultiplePatients,
  NavigationPanelReveal,
  OHIFLogo,
  Patient,
  Pin,
  PinFill,
  Plus,
  PowerOff,
  Refresh,
  Rename,
  Series,
  Settings,
  Show,
  SidePanelCloseLeft,
  SidePanelCloseRight,
  SocialGithub,
  SortingAscending,
  SortingDescending,
  Sorting,
  StatusError,
  StatusSuccess,
  StatusTracking,
  StatusWarning,
  StatusUntracked,
  Tab4D,
  TabLinear,
  TabPatientInfo,
  TabRoiThreshold,
  TabSegmentation,
  TabStudies,
  ThumbnailView,
  Trash,
  ViewportViews,
  ChevronClosed,
  ChevronOpen,
  ChevronRight: (props: IconProps) => ProChevronRight(props),
  ChevronLeft,
  ChevronDown: (props: IconProps) => ProChevronDown(props),
  ChevronUp: (props: IconProps) => ProChevronUp(props),
  Alert,
  AlertOutline,
  NotificationInfo,
  StatusLocked,
  ContentPrev,
  ContentNext,
  CheckBoxChecked,
  CheckBoxUnchecked,
  Close,
  Pause,
  Play,
  Link,
  LoadingOHIFMark,
  ArrowLeft: (props: IconProps) => ProArrowLeft(props),
  ArrowRight,
  ArrowLeftBold,
  ArrowRightBold: (props: IconProps) => {
    return (
      <ArrowLeftBold
        {...props}
        className={`${props.className || ''} rotate-180`.trim()}
      />
    );
  },
  ArrowDown: (props: IconProps) => {
    return (
      <ChevronOpen
        {...props}
        className={`${props.className || ''} -rotate-90`.trim()}
      />
    );
  },
  ViewportWindowLevel,
  Search,
  Clear,
  LayoutCommon2x3,
  LayoutCommon2x2,
  LayoutCommon1x1,
  LayoutCommon1x2,
  LayoutAdvanced3DFourUp,
  LayoutAdvanced3DMain,
  LayoutAdvanced3DOnly,
  LayoutAdvanced3DPrimary,
  LayoutAdvancedAxialPrimary,
  LayoutAdvancedMPR,
  ToolLayout,
  IconColorLUT,
  ToolEraser,
  ToolBrush,
  ToolThreshold,
  ToolShape,
  ToolLabelmapAssist,
  ToolSegmentAnything,
  ToolPETSegment,
  ToolInterpolation,
  ToolBidirectionalSegment,
  ToolContract,
  ToolExpand,
  ExternalLink,
  OHIFLogoColorDarkBackground,
  Magnifier,
  Pencil,
  WindowLevelAdvanced,
  Opacity,
  Threshold,
  ActionsSmooth,
  ActionsSimplify,
  ActionsCombine,
  ActionsCombineMerge,
  ActionsCombineSubtract,
  ActionsCombineIntersect,
  ActionsSetting,
  ActionsBidirectional,
  ActionsInterpolate,
  HelperCombineSubtract,
  HelperCombineIntersect,
  HelperCombineMerge,
  //
  //
  //
  //
  //
  //
  //
  //
  //
  // Aliases
  'prev-arrow': (props: IconProps) => Icons.ArrowLeftBold(props),
  'next-arrow': (props: IconProps) => Icons.ArrowRightBold(props),
  'loading-ohif-mark': (props: IconProps) => LoadingOHIFMark(props),
  magnifier: (props: IconProps) => Magnifier(props),
  'status-alert-warning': (props: IconProps) => StatusWarning(props),
  'logo-dark-background': (props: IconProps) => OHIFLogoColorDarkBackground(props),
  'external-link': (props: IconProps) => ExternalLink(props),
  'checkbox-checked': (props: IconProps) => CheckBoxChecked(props),
  'checkbox-unchecked': (props: IconProps) => CheckBoxUnchecked(props),
  'checkbox-default': (props: IconProps) => CheckBoxUnchecked(props),
  'checkbox-active': (props: IconProps) => CheckBoxChecked(props),
  'icon-tool-eraser': (props: IconProps) => ToolEraser(props),
  'icon-tool-brush': (props: IconProps) => ToolBrush(props),
  'icon-labelmap-slice-propagation': (props: IconProps) => ToolLabelmapAssist(props),
  'icon-marker-labelmap': (props: IconProps) => ToolSegmentAnything(props),
  'icon-tool-threshold': (props: IconProps) => ToolThreshold(props),
  'icon-tool-click-segment': (props: IconProps) => ToolClickSegment(props),
  'icon-tool-pet-segment': (props: IconProps) => ToolPETSegment(props),
  'icon-tool-interpolation': (props: IconProps) => ToolInterpolation(props),
  'icon-tool-bidirectional-segment': (props: IconProps) => ToolBidirectionalSegment(props),
  'icon-tool-expand': (props: IconProps) => ProIconToolExpand(props),
  'icon-tool-contract': (props: IconProps) => ToolContract(props),
  'icon-tool-shape': (props: IconProps) => ToolShape(props),
  link: (props: IconProps) => Link(props),
  'icon-color-lut': (props: IconProps) => IconColorLUT(props),
  'icon-link': (props: IconProps) => Link(props),
  'icon-clear': (props: IconProps) => ProIconClear(props),
  'icon-search': (props: IconProps) => Search(props),
  'viewport-window-level': (props: IconProps) => ViewportWindowLevel(props),
  'action-new-dialog': (props: IconProps) => ActionNewDialog(props),
  'arrow-left': (props: IconProps) => Icons.ArrowLeft(props),
  'arrow-right': (props: IconProps) => Icons.ArrowRight(props),
  'arrow-down': (props: IconProps) => Icons.ArrowDown(props),
  'status-tracked': (props: IconProps) => StatusTracking(props),
  'status-untracked': (props: IconProps) => StatusUntracked(props),
  'status-locked': (props: IconProps) => StatusLocked(props),
  'tab-contours': (props: IconProps) => TabContours(props),
  TabContours: (props: IconProps) => TabContours(props),
  'tab-segmentation': (props: IconProps) => TabSegmentation(props),
  'tab-studies': (props: IconProps) => TabStudies(props),
  'tab-linear': (props: IconProps) => TabLinear(props),
  'tab-4d': (props: IconProps) => Tab4D(props),
  'tab-patient-info': (props: IconProps) => TabPatientInfo(props),
  'tab-roi-threshold': (props: IconProps) => TabRoiThreshold(props),
  'icon-mpr': (props: IconProps) => IconMPR(props),
  'power-off': (props: IconProps) => PowerOff(props),
  'icon-multiple-patients': (props: IconProps) => MultiplePatients(props),
  'icon-patient': (props: IconProps) => Patient(props),
  'chevron-down': (props: IconProps) => ProChevronDown(props),
  'chevron-up': (props: IconProps) => ProChevronUp(props),
  'chevron-right': (props: IconProps) => ProChevronRight(props),
  'chevron-left': (props: IconProps) => ChevronLeft(props),
  'caret-sort': (props: IconProps) => ProCaretSort(props),
  check: (props: IconProps) => ProCheck(props),
  'dot-filled': (props: IconProps) => ProDotFilled(props),
  'close-x': (props: IconProps) => ProCloseX(props),
  'tool-length': (props: IconProps) => ProToolLength(props),
  'tool-3d-rotate': (props: IconProps) => ProTool3DRotate(props),
  'tool-angle': (props: IconProps) => ProToolAngle(props),
  'tool-annotate': (props: IconProps) => ProToolAnnotate(props),
  'tool-bidirectional': (props: IconProps) => ProToolBidirectional(props),
  'tool-calibration': (props: IconProps) => ProToolCalibration(props),
  'tool-capture': (props: IconProps) => ProToolCapture(props),
  'tool-cine': (props: IconProps) => ProToolCine(props),
  'tool-circle': (props: IconProps) => ProToolCircle(props),
  'tool-cobb-angle': (props: IconProps) => ProIconToolCobbAngle(props),
  'tool-create-threshold': (props: IconProps) => ToolCreateThreshold(props),
  'tool-crosshair': (props: IconProps) => ProToolCrosshair(props),
  'tool-crosshair-checked': (props: IconProps) => ProToolCrosshairChecked(props),
  'dicom-tag-browser': (props: IconProps) => ToolDicomTagBrowser(props),
  'tool-flip-horizontal': (props: IconProps) => ProToolFlipHorizontal(props),
  'tool-freehand-polygon': (props: IconProps) => ToolFreehandPolygon(props),
  'tool-freehand-roi': (props: IconProps) => ProIconToolFreehandRoi(props),
  'icon-tool-freehand-roi': (props: IconProps) => ProIconToolFreehandRoi(props),
  'icon-tool-spline-roi': (props: IconProps) => ProIconToolSplineRoi(props),
  'tool-freehand': (props: IconProps) => ToolFreehand(props),
  'tool-fusion-color': (props: IconProps) => ToolFusionColor(props),
  'tool-invert': (props: IconProps) => ProToolInvert(props),
  'tool-layout-default': (props: IconProps) => ToolLayoutDefault(props),
  'tool-magnetic-roi': (props: IconProps) => ToolMagneticRoi(props),
  'icon-tool-livewire': (props: IconProps) => ProIconToolLivewire(props),
  'tool-magnify': (props: IconProps) => ProToolMagnify(props),
  'tool-measure-ellipse': (props: IconProps) => ToolMeasureEllipse(props),
  'tool-more-menu': (props: IconProps) => ToolMoreMenu(props),
  'tool-move': (props: IconProps) => ProToolMove(props),
  'tool-polygon': (props: IconProps) => ToolPolygon(props),
  'tool-ellipse': (props: IconProps) => ProToolEllipse(props),
  'tool-quick-magnify': (props: IconProps) => ProToolQuickMagnify(props),
  'tool-rectangle': (props: IconProps) => ProToolRectangle(props),
  'tool-referenceLines': (props: IconProps) => ProToolReferenceLines(props),
  'tool-reset': (props: IconProps) => ProToolReset(props),
  'tool-rotate-right': (props: IconProps) => ProToolRotateRight(props),
  'tool-rotate-180': (props: IconProps) => ProToolRotate180(props),
  'icon-tool-sculptor': (props: IconProps) => ToolSculptor(props),
  'tool-seg-brush': (props: IconProps) => ToolSegBrush(props),
  'tool-seg-eraser': (props: IconProps) => ToolSegEraser(props),
  'tool-seg-shape': (props: IconProps) => ToolSegShape(props),
  'tool-seg-threshold': (props: IconProps) => ToolSegThreshold(props),
  'tool-spline-roi': (props: IconProps) => ToolSplineRoi(props),
  'tool-stack-image-sync': (props: IconProps) => ProToolStackImageSync(props),
  'tool-stack-scroll': (props: IconProps) => ProToolStackScroll(props),
  'toggle-dicom-overlay': (props: IconProps) => ProToggleDicomOverlay(props),
  'tool-ultrasound-bidirectional': (props: IconProps) => ProIconToolUltrasoundBidirectional(props),
  'tool-window-level': (props: IconProps) => ProToolWindowLevel(props),
  'tool-window-region': (props: IconProps) => ProIconToolWindowRegion(props),
  'tool-segment-label': (props: IconProps) => ProToolSegmentLabel(props),
  'icon-tool-window-region': (props: IconProps) => ProIconToolWindowRegion(props),
  'icon-tool-ultrasound-bidirectional': (props: IconProps) =>
    ProIconToolUltrasoundBidirectional(props),
  'icon-tool-cobb-angle': (props: IconProps) => ProIconToolCobbAngle(props),
  'icon-tool-loupe': (props: IconProps) => ProToolMagnify(props),
  'tool-probe': (props: IconProps) => ProToolProbe(props),
  'icon-tool-probe': (props: IconProps) => ProToolProbe(props),
  'tool-zoom': (props: IconProps) => ProToolZoom(props),
  'tool-layout': (props: IconProps) => ProToolLayout(props),
  'icon-transferring': (props: IconProps) => IconTransferring(props),
  'icon-alert-small': (props: IconProps) => Alert(props),
  'icon-alert-outline': (props: IconProps) => AlertOutline(props),
  'status-alert': (props: IconProps) => StatusAlert(props),
  info: (props: IconProps) => Info(props),
  'notifications-info': (props: IconProps) => NotificationInfo(props),
  'notificationwarning-diamond': (props: IconProps) => NotificationWarning(props),
  'content-prev': (props: IconProps) => ContentPrev(props),
  'content-next': (props: IconProps) => ContentNext(props),
  'icon-settings': (props: IconProps) => Settings(props),
  close: (props: IconProps) => Close(props),
  pause: (props: IconProps) => Pause(props),
  'icon-pause': (props: IconProps) => Pause(props),
  settings: (props: IconProps) => Settings(props),
  play: (props: IconProps) => Play(props),
  'icon-play': (props: IconProps) => Play(props),
  'layout-advanced-3d-four-up': (props: IconProps) => ProLayoutAdvanced3DFourUp(props),
  'layout-advanced-3d-main': (props: IconProps) => ProLayoutAdvanced3DMain(props),
  'layout-advanced-3d-only': (props: IconProps) => ProLayoutAdvanced3DOnly(props),
  'layout-advanced-3d-primary': (props: IconProps) => ProLayoutAdvanced3DPrimary(props),
  'layout-advanced-axial-primary': (props: IconProps) => ProLayoutAdvancedAxialPrimary(props),
  'layout-advanced-mpr': (props: IconProps) => ProLayoutAdvancedMPR(props),
  // New, distinct icons for hanging protocols that previously all shared
  // 'layout-advanced-mpr' generically (mpr2up.ts, mpr2upCoronal.ts,
  // fusion.ts, and the PetCtFusion toolbar button all looked identical).
  'layout-advanced-sagittal': (props: IconProps) => ProLayoutAdvancedSagittal(props),
  'layout-advanced-coronal': (props: IconProps) => ProLayoutAdvancedCoronal(props),
  'layout-advanced-fusion': (props: IconProps) => ProLayoutAdvancedFusion(props),
  // Was 'tool-stack-scroll', reused as a placeholder - collided visually
  // with the actual Stack Scroll toolbar button.
  'layout-advanced-frame-view': (props: IconProps) => ProLayoutAdvancedFrameView(props),
  'layout-common-1x1': (props: IconProps) => ProLayout1x1(props),
  'layout-common-1x2': (props: IconProps) => ProLayout1x2(props),
  'layout-common-2x2': (props: IconProps) => ProLayout2x2(props),
  'layout-common-2x3': (props: IconProps) => ProLayout2x3(props),
  pencil: (props: IconProps) => Pencil(props),
  'icon-list-view': (props: IconProps) => ListView(props),
  'chevron-menu': 'chevron-down',
  'icon-status-alert': (props: IconProps) => Alert(props),
  'info-link': (props: IconProps) => InfoLink(props),
  'launch-info': (props: IconProps) => LaunchInfo(props),
  'old-trash': (props: IconProps) => Trash(props),
  'tool-point': (props: IconProps) => ToolCircle(props),
  'tool-freehand-line': (props: IconProps) => ToolFreehand(props),
  'tool-labelmap-edit-with-contour': (props: IconProps) => ToolLabelmapEditWithContour(props),
  'actions-smooth': (props: IconProps) => ActionsSmooth(props),
  'actions-simplify': (props: IconProps) => ActionsSimplify(props),
  'actions-combine': (props: IconProps) => ActionsCombine(props),
  'actions-combine-merge': (props: IconProps) => ActionsCombineMerge(props),
  'actions-combine-subtract': (props: IconProps) => ActionsCombineSubtract(props),
  'actions-combine-intersect': (props: IconProps) => ActionsCombineIntersect(props),
  'actions-bidirectional': (props: IconProps) => ActionsBidirectional(props),
  'actions-interpolate': (props: IconProps) => ActionsInterpolate(props),
  'actions-setting': (props: IconProps) => ActionsSetting(props),
  'helper-combine-subtract': (props: IconProps) => HelperCombineSubtract(props),
  'helper-combine-intersect': (props: IconProps) => HelperCombineIntersect(props),
  'helper-combine-merge': (props: IconProps) => HelperCombineMerge(props),
  clipboard: (props: IconProps) => Clipboard(props),
  Undo,
  Redo,
  JumpToSlice,
  Navigation: (props: IconProps) => ProNavigation(props),
  Status: (props: IconProps) => ProStatus(props),
  TimeIntensityCurve: TimeIntensityCurveIcon,
  IllustrationNotFound,

  /** Adds an icon to the set of icons */
  addIcon: (name: string, icon) => {
    if (Icons[name]) {
      console.warn('Replacing icon', name);
    }
    Icons[name] = icon;
  },

  ByName: ({ name, className, ...props }: { name: string; className?: string }) => {
    const IconComponent = Icons[name];

    if (!IconComponent) {
      console.debug(`Icon "${name}" not found.`);
      return <div>Missing Icon</div>;
    }

    return (
      <IconComponent
        {...props}
        className={className}
      />
    );
  },
};
