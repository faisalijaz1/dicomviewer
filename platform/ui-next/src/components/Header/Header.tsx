import React, { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
  ToolButton,
} from '../';
import { IconPresentationProvider } from '@ohif/ui-next';

import NavBar from '../NavBar';

// Todo: we should move this component to composition and remove props base

interface HeaderProps {
  children?: ReactNode;
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;
  isReturnEnabled?: boolean;
  onClickReturnButton?: () => void;
  isSticky?: boolean;
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };
  Secondary?: ReactNode;
  UndoRedo?: ReactNode;
  UserBadge?: ReactNode;
}

const SCROLL_STEP_PX = 220;

/**
 * Wraps the toolbar in a horizontally-scrollable region with left/right arrow
 * buttons that only render when there's actually overflow to scroll to in
 * that direction, so the toolbar's full content is always reachable without
 * relying on trackpad/shift-wheel scrolling.
 */
function ScrollableToolbar({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateScrollState, children]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };

  return (
    <div className="flex min-w-0 flex-1 items-center">
      {canScrollLeft && (
        <Button
          variant="ghost"
          size="icon"
          className="text-primary hover:bg-muted h-8 w-6 flex-shrink-0"
          aria-label="Scroll toolbar left"
          onClick={() => scrollBy(-SCROLL_STEP_PX)}
        >
          <Icons.ChevronLeft className="h-4 w-4" />
        </Button>
      )}
      <div
        ref={scrollRef}
        className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex items-center space-x-2">{children}</div>
      </div>
      {canScrollRight && (
        <Button
          variant="ghost"
          size="icon"
          className="text-primary hover:bg-muted h-8 w-6 flex-shrink-0"
          aria-label="Scroll toolbar right"
          onClick={() => scrollBy(SCROLL_STEP_PX)}
        >
          <Icons.ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function Header({
  children,
  menuOptions,
  isReturnEnabled = true,
  onClickReturnButton,
  isSticky = false,
  WhiteLabeling,
  UndoRedo,
  Secondary,
  UserBadge,
  ...props
}: HeaderProps): ReactNode {
  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <IconPresentationProvider
      size="large"
      IconContainer={ToolButton}
    >
      <NavBar
        isSticky={isSticky}
        {...props}
      >
        <div className="flex h-[52px] min-w-0 items-center gap-1 sm:gap-2">
          {/*
            Patient info now lives at the top of the left side panel (see
            LeftPanelBranding) instead of here, so the toolbar has more width to
            work with - but the logo/title stays in the top bar.
          */}
          <div className="flex min-w-0 shrink items-center gap-1">
            <div
              className={classNames(
                'inline-flex flex-shrink-0 items-center',
                isReturnEnabled && 'cursor-pointer'
              )}
              onClick={onClickReturn}
              data-cy="return-to-work-list"
            >
              {isReturnEnabled && <Icons.ArrowLeft className="text-primary h-6 w-6 flex-shrink-0" />}
            </div>
            {/*
              min-w-0 lets the logo/app-name (which itself uses truncate + min-w-0,
              see whiteLabeling.createLogoComponentFn) actually shrink and truncate
              on narrow/mobile widths instead of forcing the whole header wider
              than the viewport.
            */}
            <div className="ml-0.5 min-w-0 flex-shrink">
              {WhiteLabeling?.createLogoComponentFn?.(React, props) || <Icons.OHIFLogo />}
            </div>
          </div>
          {/* Secondary (mode-specific) toolbar: hidden below sm to save space on mobile. */}
          <div className="ml-1 hidden h-8 flex-shrink-0 items-center sm:flex md:ml-2">
            {Secondary}
          </div>
          <ScrollableToolbar>{children}</ScrollableToolbar>
          <div className="flex min-w-0 flex-shrink-0 select-none items-center">
            <div className="flex-shrink-0">{UndoRedo}</div>
            {UserBadge && (
              <>
                <div className="border-muted mx-1.5 h-[25px] border-r"></div>
                <div className="min-w-0 flex-shrink">{UserBadge}</div>
              </>
            )}
            <div className="border-muted mx-1.5 h-[25px] border-r"></div>
            <div className="flex-shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-primary hover:bg-muted h-full w-full"
                    data-cy="header-options-menu-btn"
                  >
                    <Icons.GearSettings />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuOptions.map((option, index) => {
                    const IconComponent = option.icon
                      ? Icons[option.icon as keyof typeof Icons]
                      : null;
                    return (
                      <DropdownMenuItem
                        key={index}
                        onSelect={option.onClick}
                        className="flex items-center gap-2 py-2"
                      >
                        {IconComponent && (
                          <span className="flex h-4 w-4 items-center justify-center">
                            <Icons.ByName name={option.icon} />
                          </span>
                        )}
                        <span className="flex-1">{option.title}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </NavBar>
    </IconPresentationProvider>
  );
}

export default Header;
