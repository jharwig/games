/**
 * Third-party attribution, for the in-game credits screen.
 *
 * Mirrors CREDITS.md — keep the two in step. The CC-BY entries are a licence
 * obligation, not a courtesy: they must stay visible somewhere in the shipped
 * game.
 */

export interface Credit {
  title: string;
  author: string;
  url: string;
  license: string;
}

export const CREDITS: Credit[] = [
  // Environment
  {
    title: 'Plains Sunset (HDRI)',
    author: 'Dimitrios Savva, Jarod Guest',
    url: 'https://polyhaven.com/a/plains_sunset',
    license: 'CC0',
  },
  {
    title: 'Withered Grass (texture)',
    author: 'Charlotte Baglioni',
    url: 'https://polyhaven.com/a/withered_grass',
    license: 'CC0',
  },
  {
    title: 'Brown Mud Dry (texture)',
    author: 'Rob Tuytel',
    url: 'https://polyhaven.com/a/brown_mud_dry',
    license: 'CC0',
  },

  // Models
  {
    title: 'Horse Rigged All Gaits',
    author: 'fdoss001',
    url: 'https://blendswap.com/blend/28627',
    license: 'CC0',
  },
  {
    title: 'Western Cowboy (Rigged)',
    author: 'stevedaman',
    url: 'https://sketchfab.com/3d-models/western-cowboy-rigged-160bf043b71c458984c81c717b7483c9',
    license: 'CC-BY 4.0',
  },
  {
    title: 'Stagecoach',
    author: 'Tuuttipingu',
    url: 'https://sketchfab.com/3d-models/stagecoach-84020334d1d047b8b77152108844e786',
    license: 'CC-BY 4.0',
  },
  {
    title: 'US Mail Stagecoach',
    author: 'choppar (KZNYKN)',
    url: 'https://sketchfab.com/3d-models/us-mail-stagecoach-17d0e94cc0ef4691a0a088ccc33f9b19',
    license: 'CC-BY 4.0',
  },
  {
    title: 'Winchester Model 1873',
    author: 'Tuuttipingu',
    url: 'https://sketchfab.com/3d-models/winchester-model-1873-f1f57078e79e49289e14f0a551b5b60e',
    license: 'CC-BY 4.0',
  },
  {
    title: 'Colt SAA "Peacemaker"',
    author: 'Tuuttipingu',
    url: 'https://sketchfab.com/3d-models/colt-saa-peacemaker-fb974d4ab8be44feb9c7acb0a1a8af75',
    license: 'CC-BY 4.0',
  },

  // Sound
  {
    title: 'Marlin.wav (Rifle shot)',
    author: 'Jon285',
    url: 'https://freesound.org/people/Jon285/sounds/76885/',
    license: 'CC0',
  },
  {
    title: 'Lever action cocking.wav',
    author: 'C-V',
    url: 'https://freesound.org/people/C-V/sounds/523401/',
    license: 'CC0',
  },
  {
    title: '44_black_powder.wav (Six-shooter)',
    author: 'Jon285',
    url: 'https://freesound.org/people/Jon285/sounds/34708/',
    license: 'CC0',
  },
  {
    title: 'Single Action Army foley (hammer cock)',
    author: 'e9118586020',
    url: 'https://freesound.org/people/e9118586020/sounds/567611/',
    license: 'CC0',
  },
  {
    title: 'Horse Galloping.wav',
    author: 'Max_Headroom',
    url: 'https://freesound.org/people/Max_Headroom/sounds/175356/',
    license: 'CC0',
  },
  {
    title: 'G38-15-Perfect Horse Whinny.wav',
    author: 'craigsmith',
    url: 'https://freesound.org/people/craigsmith/sounds/437110/',
    license: 'CC0',
  },
  {
    title: 'Field ambience 01.wav (prairie wind)',
    author: 'szelestamas',
    url: 'https://freesound.org/people/szelestamas/sounds/620099/',
    license: 'CC0',
  },
  {
    title: 'BODY FALL - V HVY - DIRT (thud)',
    author: 'leonelmail',
    url: 'https://freesound.org/people/leonelmail/sounds/504626/',
    license: 'CC0',
  },

  // Software
  {
    title: 'Three.js',
    author: 'mrdoob and contributors',
    url: 'https://threejs.org/',
    license: 'MIT',
  },
  {
    title: 'Rapier',
    author: 'Dimforge',
    url: 'https://rapier.rs/',
    license: 'Apache-2.0',
  },
];
