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
 */
export const soundFiles: Record<SoundEffect, string> = {
    [SoundEffect.PlayerShoot]: '/sounds/player-shoot.wav',
    [SoundEffect.InvaderKilled]: '/sounds/invader-killed.wav',
    [SoundEffect.PlayerDeath]: '/sounds/player-death.wav',
    [SoundEffect.InvaderShoot]: '/sounds/invader-shoot.wav',
};

export class AudioManager {
    private audioContext: AudioContext | null = null;
    private soundBuffers: Map<SoundEffect, AudioBuffer> = new Map();
    private logger: (message: string) => void;

    constructor(logger: (message: string) => void = console.log) {
        this.logger = logger;
    }

    public async initialize(): Promise<boolean> {
        this.logger("AudioManager: initialize called.");
        if (this.audioContext && this.audioContext.state === 'running') {
            this.logger("AudioManager: Context already exists and is running.");
            return true;
        }

        if (!this.audioContext) {
            try {
                this.logger("AudioManager: No AudioContext, creating a new one.");
                this.audioContext = new window.AudioContext();
                this.logger(`AudioManager: Context created. Initial state: ${this.audioContext.state}`);
            } catch (e) {
                this.logger(`ERROR: Web Audio API is not supported in this browser. ${e}`);
                return false;
            }
        }

        if (this.audioContext.state === 'suspended') {
            this.logger("AudioManager: Context is suspended, attempting to resume.");
            try {
                await this.audioContext.resume();
                this.logger(`AudioManager: Resume complete. New state: ${this.audioContext.state}`);
            } catch (e) {
                this.logger(`ERROR: Failed to resume AudioContext. ${e}`);
                return false;
            }
        }
        
        const isRunning = this.audioContext.state === 'running';
        this.logger(`AudioManager: Initialization finished. Is running: ${isRunning}`);
        return isRunning;
    }

    public async decodeSounds(soundData: Map<SoundEffect, ArrayBuffer>): Promise<void> {
        if (!this.audioContext) {
            this.logger("WARN: AudioContext not initialized. Cannot decode sounds.");
            return;
        }
        this.logger("AudioManager: Decoding sounds...");

        const decodePromises = Array.from(soundData.entries()).map(async ([key, arrayBuffer]) => {
            try {
                const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer.slice(0));
                this.soundBuffers.set(key, audioBuffer);
            } catch (e) {
                this.logger(`ERROR: Failed to decode sound: ${key}. ${e}`);
            }
        });

        await Promise.all(decodePromises);
        this.logger("AudioManager: Sound decoding complete.");
    }

    public play(key: SoundEffect): void {
        if (!this.audioContext || this.audioContext.state !== 'running') {
            const state = this.audioContext ? this.audioContext.state : 'null';
            this.logger(`WARN: Cannot play sound. AudioContext state is: ${state}`);
            return;
        }

        const buffer = this.soundBuffers.get(key);
        if (!buffer) {
            this.logger(`WARN: Sound buffer for ${key} not found.`);
            return;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.start(0);
    }
}
