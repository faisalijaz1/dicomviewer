const getToggledClassName = isToggled => {
  // Matches ToolButton's own `activeClasses` (the solid highlight-filled
  // look Stack Scroll/Zoom/Pan show when active) so every "this is
  // currently selected" tool looks the same, whether it went through
  // ToolButton's isActive prop or through an evaluate-returned className
  // like this one (sync buttons, ReferenceLines, SegmentLabelTool, etc.)
  return isToggled
    ? '!bg-highlight !text-background hover:!bg-highlight/80'
    : '!text-foreground/80 hover:!bg-muted hover:text-highlight';
};

export { getToggledClassName };
