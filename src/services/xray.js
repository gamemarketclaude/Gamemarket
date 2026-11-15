'use strict';

/** vless:// ссылка VLESS + Reality + Vision — понимают Happ, v2RayTun, Hiddify, v2rayNG. */
function vlessRealityLink(node, clientUuid) {
  const params = new URLSearchParams({
    encryption: 'none',
    flow: 'xtls-rprx-vision',
    security: 'reality',
    sni: node.sni,
    fp: 'chrome',
    pbk: node.public_key,
    sid: node.short_id,
    type: 'tcp',
  });
  const host = node.host.includes(':') ? `[${node.host}]` : node.host;
  return `vless://${clientUuid}@${host}:${node.port}?${params}#${encodeURIComponent(node.name)}`;
}

module.exports = { vlessRealityLink };
