// The HUD elements in index.html.

import { $ } from '../platform.js';

export const ui = {
  hud: $('#hud'), setup: $('#setup'), board: $('#board'), bag: $('#bag'), pick: $('#pick'), pickTitle: $('#pickTitle'), pickInfo: $('#pickInfo'), pickFoot: $('#pickFoot'),
  bagBtn: $('#bagBtn'), lockPrompt: $('#lockPrompt'), retPower: $('#retPower'), fire: $('#fireBtn'), fill: $('#fireFill'), fireSub: $('#fireSub'),
  hint: $('#hint'), banner: $('#banner'), callout: $('#callout'), coBig: $('#coBig'), coSmall: $('#coSmall'), toast: $('#toast'),
  map: $('#map'), mute: $('#muteBtn'), zoom: $('#zoomBtn'), left: $('#leftBtn'), right: $('#rightBtn'), up: $('#upBtn'), down: $('#downBtn'),
  choose: $('#choose'), chooseRow: $('#chooseRow'), windArrow: $('#windArrow'), hcWind: $('#hcWind'), hcWindRel: $('#hcWindRel'),
  clock: $('#hcClock'), reticle: $('#reticle'), retMove: $('#retMove'), retPitch: $('#retPitch'), retTarget: $('#retTarget'), rlMax: $('#rlMax'), rlMin: $('#rlMin'), rlMark: $('#rlMark')
};
