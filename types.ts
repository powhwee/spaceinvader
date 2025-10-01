export enum ModelType {
  Cube,
  PlayerShip,
  Invader,
  Laser,
}

export type Position = {
  x: number;
  y: number;
  z: number;
};

export type GameObject = {
  id: number;
  position: Position;
  size: { width: number; height: number; depth: number };
  modelType: ModelType;
};

export type Player = GameObject;

export type Invader = GameObject & {
  type: number;
};

export type Laser = GameObject;

export type Particle = GameObject & {
  velocity: Position;
  life: number; // time in seconds
  initialLife: number;
  color: number[];
};

export enum GameState {
  StartMenu,
  Playing,
  GameOver,
}