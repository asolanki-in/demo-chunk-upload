// goIosWrapper.ts

import fs from 'fs';
import { execa } from 'execa';
import { spawn, ChildProcess } from 'child_process';

/**
 * Raw JSON shape returned by `ios list --details`.
 */
interface RawDeviceInfo {
  UDID: string;
  Name?: string;
  ProductVersion?: string;
  Model?: string;
  [key: string]: any;
}

/**
 * Cleaned up device info.
 */
export interface DeviceInfo {
  udid: string;
  name?: string;
  version?: string;
  model?: string;
}

/**
 * Wrapper around the go-ios CLI for macOS.
 * Supports:
 *  - listDevices
 *  - installApp
 *  - uninstallApp
 *  - launchWebDriverAgent / stopWebDriverAgent
 *  - rebootDevice
 *  - launchApp (with optional wait & killExisting) / stopTunnel
 *
 * Automatically handles iOS 17+ tunnel startup and maps JSON fields correctly.
 */
export class GoIosWrapper {
  private iosBinary: string;
  private tunnelStarted = false;
  private tunnelProcess?: ChildProcess;

  constructor(iosBinary: string = 'ios') {
    this.iosBinary = iosBinary;
  }

  /**
   * Start the go-ios tunnel daemon (detached).
   * Required for iOS 17+ devices. 
   */
  private async startTunnel(): Promise<void> {
    if (this.tunnelStarted) return;

    this.tunnelProcess = spawn(
      this.iosBinary,
      ['tunnel', 'start'],
      { stdio: 'ignore', detached: true }
    );
    this.tunnelProcess.unref();

    // Wait briefly for the tunnel interface to initialize
    await new Promise(res => setTimeout(res, 2000));
    this.tunnelStarted = true;
  }

  /**
   * Compare major version numbers.
   */
  private versionAtLeast(version: string, major: number): boolean {
    const maj = parseInt(version.split('.')[0], 10);
    return maj >= major;
  }

  /**
   * If device is iOS 17+, ensure tunnel is running before proceeding.
   */
  private async ensureTunnelForDevice(udid: string): Promise<void> {
    const devices = await this.listDevices();
    const device = devices.find(d => d.udid === udid);
    if (!device) throw new Error(`Unknown device UDID: ${udid}`);
    if (device.version && this.versionAtLeast(device.version, 17)) {
      await this.startTunnel();
    }
  }

  /**
   * List all connected devices with details.
   * Uses: `ios list --details` 
   */
  public async listDevices(): Promise<DeviceInfo[]> {
    try {
      const { stdout } = await execa(this.iosBinary, ['list', '--details']);
      const raw = JSON.parse(stdout) as RawDeviceInfo[];
      return raw.map(d => ({
        udid: d.UDID,
        name: d.Name,
        version: d.ProductVersion,
        model: d.Model
      }));
    } catch (err: any) {
      throw new Error(`Failed to list devices: ${err.stderr || err.message}`);
    }
  }

  /**
   * Ensure the file exists, else throw.
   */
  private validateFilePath(path: string): void {
    if (!fs.existsSync(path)) {
      throw new Error(`File not found: ${path}`);
    }
  }

  /**
   * Install an IPA or .app on the device.
   * Uses: `ios install --path <path> --udid <udid>` 
   */
  public async installApp(udid: string, path: string): Promise<void> {
    this.validateFilePath(path);
    await this.ensureTunnelForDevice(udid);
    try {
      await execa(this.iosBinary, ['install', '--path', path, `--udid=${udid}`]);
    } catch (err: any) {
      throw new Error(`Install failed: ${err.stderr || err.message}`);
    }
  }

  /**
   * Uninstall an app by bundle identifier.
   * Uses: `ios uninstall <bundleId> --udid <udid>` 
   */
  public async uninstallApp(udid: string, bundleId: string): Promise<void> {
    await this.ensureTunnelForDevice(udid);
    try {
      await execa(this.iosBinary, ['uninstall', bundleId, `--udid=${udid}`]);
    } catch (err: any) {
      throw new Error(`Uninstall failed: ${err.stderr || err.message}`);
    }
  }

  /**
   * Launch WebDriverAgent on the device.
   * Returns the detached ChildProcess so you can stop it later.
   * Uses: `ios runwda --udid <udid>` 
   */
  public async launchWebDriverAgent(udid: string, logFile?: string): Promise<ChildProcess> {
    await this.ensureTunnelForDevice(udid);
    const args = ['runwda', `--udid=${udid}`];
    if (logFile) args.push(`--log-output=${logFile}`);

    const proc = spawn(this.iosBinary, args, { stdio: 'ignore', detached: true });
    proc.unref();
    return proc;
  }

  /**
   * Stop a running WebDriverAgent process (and its process group).
   */
  public stopWebDriverAgent(proc: ChildProcess): void {
    if (proc.pid) {
      process.kill(-proc.pid);
    }
  }

  /**
   * Reboot the device.
   * Uses: `ios reboot --udid <udid>` 
   */
  public async rebootDevice(udid: string): Promise<void> {
    await this.ensureTunnelForDevice(udid);
    try {
      await execa(this.iosBinary, ['reboot', `--udid=${udid}`]);
    } catch (err: any) {
      throw new Error(`Reboot failed: ${err.stderr || err.message}`);
    }
  }

  /**
   * Launch an installed app by bundle ID.
   * If opts.wait is true, returns a ChildProcess streaming logs;
   * otherwise resolves when launch is triggered.
   * Uses: `ios launch <bundleId> [--kill-existing] [--wait] --udid <udid>` 
   */
  public async launchApp(
    udid: string,
    bundleId: string,
    opts?: { killExisting?: boolean; wait?: boolean }
  ): Promise<ChildProcess | void> {
    await this.ensureTunnelForDevice(udid);

    const args = ['launch', bundleId, `--udid=${udid}`];
    if (opts?.killExisting) args.push('--kill-existing');
    if (opts?.wait) args.push('--wait');

    if (opts?.wait) {
      const proc = spawn(this.iosBinary, args, { stdio: 'inherit', detached: true });
      proc.unref();
      return proc;
    } else {
      try {
        await execa(this.iosBinary, args);
      } catch (err: any) {
        throw new Error(`Launch failed: ${err.stderr || err.message}`);
      }
    }
  }

  /**
   * Stop the tunnel daemon if it was started.
   */
  public stopTunnel(): void {
    if (this.tunnelProcess && this.tunnelStarted) {
      process.kill(-this.tunnelProcess.pid!);
      this.tunnelStarted = false;
    }
  }
}