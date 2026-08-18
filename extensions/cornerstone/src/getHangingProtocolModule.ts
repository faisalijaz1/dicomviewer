import { fourUp } from './hps/fourUp';
import { fusion } from './hps/fusion';
import { main3D } from './hps/main3D';
import { mpr } from './hps/mpr';
import { mpr2up } from './hps/mpr2up';
import { mpr2upCoronal } from './hps/mpr2upCoronal';
import { mprAnd3DVolumeViewport } from './hps/mprAnd3DVolumeViewport';
import { only3D } from './hps/only3D';
import { primary3D } from './hps/primary3D';
import { primaryAxial } from './hps/primaryAxial';
import { frameView } from './hps/frameView';

function getHangingProtocolModule() {
  return [
    {
      name: mpr.id,
      protocol: mpr,
    },
    {
      name: mpr2up.id,
      protocol: mpr2up,
    },
    {
      name: mpr2upCoronal.id,
      protocol: mpr2upCoronal,
    },
    {
      name: fusion.id,
      protocol: fusion,
    },
    {
      name: mprAnd3DVolumeViewport.id,
      protocol: mprAnd3DVolumeViewport,
    },
    {
      name: fourUp.id,
      protocol: fourUp,
    },
    {
      name: main3D.id,
      protocol: main3D,
    },
    {
      name: primaryAxial.id,
      protocol: primaryAxial,
    },
    {
      name: only3D.id,
      protocol: only3D,
    },
    {
      name: primary3D.id,
      protocol: primary3D,
    },
    {
      name: frameView.id,
      protocol: frameView,
    },
  ];
}

export default getHangingProtocolModule;
