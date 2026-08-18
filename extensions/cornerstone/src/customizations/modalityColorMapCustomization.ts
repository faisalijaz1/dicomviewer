export default {
  'cornerstone.modalityOverlayDefaultColorMaps': {
    defaultSettings: {
      PT: {
        // RadiAnt's PET-CT fusion manual: PET is displayed with a "Hot
        // iron" color scale. The stock OHIF default here was 'hsv' - a
        // cyclic hue-wheel colormap that renders BOTH the lowest and
        // highest values as red (RGBPoints run red -> magenta -> blue ->
        // cyan -> green -> yellow -> red) - so any background/low-activity
        // pixel that leaks through the opacity ramp shows up red, which is
        // what produced the "weird red wash" outside real uptake. hot_iron
        // is a monotonic black -> red -> orange -> yellow -> white ramp,
        // matching RadiAnt and making stray low-end pixels render dark
        // instead of red.
        colormap: 'hot_iron',
        // Note: Right now, there is a nonlinear relationship between the opacity value
        // below and how it will get applied to the image. The limitation is in rendering.
        // We are working on this and will remove this note when it's fixed.
        // But don't expect 0.5 to be 50% opacity, but rather close to that.
        opacity: 0.5,
      },
      RTDOSE: {
        colormap: 'Isodose',
        // Note: Right now, there is a nonlinear relationship between the opacity value
        // below and how it will get applied to the image. The limitation is in rendering.
        // We are working on this and will remove this note when it's fixed.
        // But don't expect 0.5 to be 50% opacity, but rather close to that.

        opacity: 0.5,
      },
    },
  },
};
