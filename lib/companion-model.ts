export const transparentParts = [
  'Part',
  'Part34',
  'MBWJJ_wutishiliangxunhuan2',
  'MBWJJ_wutishiliangS',
  'MBWJJ_wutishiliangZ',
  'MBWJJ_wutishiliangX',
] as const;

type ModelParts = {
  parts: { ids: string[]; parentIndices: Int32Array; opacities: Float32Array };
  drawables: { parentPartIndices?: Int32Array; opacities: Float32Array };
};

/** Hide complete part subtrees, including meshes restored by authored motions. */
export function createPartVisibility(model: ModelParts) {
  const requested = new Set<string>(transparentParts);
  const hiddenParts = model.parts.ids.map((_, index) => {
    let part = index;
    for (let depth = 0; part >= 0 && depth < model.parts.ids.length; depth++) {
      if (requested.has(model.parts.ids[part])) return true;
      part = model.parts.parentIndices[part];
    }
    return false;
  });
  const parents = model.drawables.parentPartIndices;
  if (
    !parents ||
    transparentParts.some((id) => !model.parts.ids.includes(id))
  ) {
    throw new Error('Live2D part hierarchy is unavailable');
  }
  const hiddenMeshes = Array.from(
    parents,
    (part) => hiddenParts[part] ?? false,
  );
  return () => {
    hiddenParts.forEach((hidden, index) => {
      if (hidden) model.parts.opacities[index] = 0;
    });
    hiddenMeshes.forEach((hidden, index) => {
      if (hidden) model.drawables.opacities[index] = 0;
    });
  };
}
