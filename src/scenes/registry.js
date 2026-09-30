/**
 * Scene registry: name → lazy loader. The ONLY file that references every scene.
 * Adding a scene: create src/scenes/<name>/<Name>Scene.js (default export class
 * extending core/Scene) and add a line here.
 */
export const SCENE_LOADERS = {
  title: () => import('./title/TitleScene.js'),
  create: () => import('./create/CreateScene.js'),
  explore: () => import('./explore/ExploreScene.js'),
  combat: () => import('./combat/CombatScene.js'),
  automap: () => import('./automap/AutomapScene.js'),
  camp: () => import('./camp/CampScene.js'),
  dialogue: () => import('./dialogue/DialogueScene.js'),
  shop: () => import('./shop/ShopScene.js'),
};
