export type Position = {
  x: number;
  y: number;
};

export type GameObject = {
  id: number;
  position: Position;
  size: { width: number; height: number };
};

// FIX: Export the 'Player' type as an alias of 'GameObject' to resolve the import error.
export type Player = GameObject;

export type Invader = GameObject & {
  type: number;
};

export type Laser = GameObject;

export type Particle = GameObject & {
  velocity: Position;
  life: number; // time in seconds
  color: number[];
};

export enum GameState {
  StartMenu,
  Playing,
  GameOver,
}
