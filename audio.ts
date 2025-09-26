// src/audio.ts

/**
 * Enum for sound effect keys to provide type safety and prevent magic strings.
 */
export enum SoundEffect {
    PlayerShoot = 'playerShoot',
    InvaderKilled = 'invaderKilled',
    PlayerDeath = 'playerDeath',
    InvaderShoot = 'invaderShoot',
}

/**
 * A map defining the file paths for each sound effect.
 * You will need to create these sound files and place them in your `public/sounds/` directory.
 */
const soundFiles: Record<SoundEffect, string> = {
    [SoundEffect.PlayerShoot]: '/sounds/player-shoot.wav',
    [SoundEffect.InvaderKilled]: '/sounds/invader-killed.wav',
    [SoundEffect.PlayerDeath]: '/sounds/player-death.wav',
    [SoundEffect.InvaderShoot]: '/sounds/invader-shoot.wav',
};

export class AudioManager {
    private audioContext: AudioContext | null = null;
    private soundBuffers: Map<SoundEffect, AudioBuffer> = new Map();

    /**
     * Initializes the AudioContext. Must be called after a user interaction
     * (e.g., clicking a "Start Game" button) to comply with browser autoplay policies.
     */
    public initialize(): void {
        if (this.audioContext) return;
        try {
            this.audioContext = new window.AudioContext();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser.", e);
        }
    }

    /**
     * Loads all defined sound effects into memory.
     * Call this after `initialize`.
     */
    public async loadSounds(): Promise<void> {
        if (!this.audioContext) {
            console.warn("AudioContext not initialized. Cannot load sounds.");
            return;
        }

        const soundPromises = Object.entries(soundFiles).map(async ([key, path]) => {
            try {
                const response = await fetch(path);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
                this.soundBuffers.set(key as SoundEffect, audioBuffer);
            } catch (e) {
                console.error(`Failed to load sound: ${key}`, e);
            }
        });

        await Promise.all(soundPromises);
    }

    /**
     * Plays a pre-loaded sound effect.
     * @param key The SoundEffect to play.
     */
    public play(key: SoundEffect): void {
        if (!this.audioContext || !this.soundBuffers.has(key)) return;

        const source = this.audioContext.createBufferSource();
        source.buffer = this.soundBuffers.get(key)!;
        source.connect(this.audioContext.destination);
        source.start(0);
    }
}