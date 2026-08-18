import React from 'react';
import { Enums } from '@cornerstonejs/core';
import {
  Numeric,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Button,
} from '@ohif/ui-next';
import { useViewportRendering } from '../../hooks';

interface SlabThicknessMenuProps {
  viewportId: string;
  className?: string;
}

const BLEND_MODE_OPTIONS = [
  { value: String(Enums.BlendModes.COMPOSITE), label: 'Composite' },
  { value: String(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND), label: 'MIP (Thick slab)' },
  { value: String(Enums.BlendModes.MINIMUM_INTENSITY_BLEND), label: 'MinIP' },
  { value: String(Enums.BlendModes.AVERAGE_INTENSITY_BLEND), label: 'Average' },
];

const THIN_SLICE_THICKNESS = 0.1;

function SlabThicknessMenu({ viewportId, className }: SlabThicknessMenuProps) {
  const {
    slabThickness,
    setSlabThickness,
    slabThicknessRange,
    blendMode,
    setBlendMode,
  } = useViewportRendering(viewportId);

  const { min, max } = slabThicknessRange;
  const thicknessValue = slabThickness ?? min;

  return (
    <div className={className}>
      <div className="bg-popover w-72 rounded-lg p-4 shadow-md">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-muted-foreground text-base">Slab Thickness</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setBlendMode(Enums.BlendModes.COMPOSITE);
              setSlabThickness(THIN_SLICE_THICKNESS);
            }}
            className="text-sm"
          >
            Thin slice
          </Button>
        </div>

        <div className="mb-3">
          <Select
            value={blendMode !== undefined ? String(blendMode) : undefined}
            onValueChange={val => setBlendMode(Number(val) as Enums.BlendModes)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Blend mode" />
            </SelectTrigger>
            <SelectContent>
              {BLEND_MODE_OPTIONS.map(opt => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Numeric.Container
          mode="singleRange"
          value={thicknessValue}
          onChange={(val: number | [number, number]) => {
            if (typeof val === 'number') {
              setSlabThickness(val);
            }
          }}
          min={min}
          max={max}
          step={0.1}
        >
          <Numeric.SingleRange />
          <div className="mt-1 flex justify-between">
            <span className="text-muted-foreground text-sm">{min.toFixed(1)} mm</span>
            <span className="text-muted-foreground text-sm">{max.toFixed(1)} mm</span>
          </div>
        </Numeric.Container>
      </div>
    </div>
  );
}

export default SlabThicknessMenu;
