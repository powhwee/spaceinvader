
import React from 'react';
import type { Player, Invader, Laser } from '../types';

interface PlayerProps {
  player: Player;
}

export const PlayerComponent: React.FC<PlayerProps> = ({ player }) => (
  <div
    className="bg-cyan-400 shadow-[0_0_8px_rgba(0,255,255,0.7)]"
    style={{
      position: 'absolute',
      left: `${player.position.x}px`,
      top: `${player.position.y}px`,
      width: `${player.size.width}px`,
      height: `${player.size.height}px`,
      clipPath: 'polygon(50% 0%, 10% 100%, 90% 100%)',
    }}
  />
);

interface InvaderProps {
  invader: Invader;
}

const invaderColors = [
  'bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.7)]',
  'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.7)]',
  'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.7)]',
  'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]',
  'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.7)]',
];

export const InvaderComponent: React.FC<InvaderProps> = ({ invader }) => (
  <div
    className={`${invaderColors[invader.type % invaderColors.length]}`}
    style={{
      position: 'absolute',
      left: `${invader.position.x}px`,
      top: `${invader.position.y}px`,
      width: `${invader.size.width}px`,
      height: `${invader.size.height}px`,
    }}
  />
);

interface LaserProps {
  laser: Laser;
  isPlayerLaser?: boolean;
}

export const LaserComponent: React.FC<LaserProps> = ({ laser, isPlayerLaser = true }) => {
  const colorClass = isPlayerLaser 
    ? 'bg-green-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.8)]' 
    : 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]';
  
  return (
    <div
      className={colorClass}
      style={{
        position: 'absolute',
        left: `${laser.position.x}px`,
        top: `${laser.position.y}px`,
        width: `${laser.size.width}px`,
        height: `${laser.size.height}px`,
      }}
    />
  );
};
