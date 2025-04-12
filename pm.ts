// src/ProcessManager.ts
import pm2 from "pm2";
import { EventEmitter } from "events";

interface ProcessData {
	script: string;
	args?: string[];
	env?: { [key: string]: string };
}

interface PM2BusEvent {
	event: string;
	process: {
		name: string;
		pm_id: number;
		[key: string]: any;
	};
}

export class ProcessManager extends EventEmitter {
	private static instance: ProcessManager;
	private connected = false;
	private bus: any = null;

	private constructor() {
		super();
		this._initPm2();
	}

	public static getInstance(): ProcessManager {
		if (!ProcessManager.instance) {
			ProcessManager.instance = new ProcessManager();
		}
		return ProcessManager.instance;
	}

	private _initPm2() {
		pm2.connect((err) => {
			if (err) {
				this.emit("error", new Error("PM2 connection failed: " + err.message));
				return;
			}

			this.connected = true;
			this.emit("connected");

			pm2.launchBus((err, bus) => {
				if (err) {
					this.emit("error", new Error("Launching PM2 bus failed: " + err.message));
					return;
				}

				this.bus = bus;
				bus.on("process:event", (data: PM2BusEvent) => {
					this.emit("processEvent", data);
					if (data.process?.name) {
						this.emit(`${data.process.name}:${data.event}`, data);
					}
				});
			});
		});
	}

	public startProcess(processData: ProcessData, uid: string): void {
		if (!this.connected) {
			this.emit("error", new Error("Not connected to PM2. Process start aborted."));
			return;
		}

		const options = Object.assign({}, processData, { name: uid });

		pm2.start(options, (err, proc) => {
			if (err) {
				this.emit("error", new Error(`Failed to start process [${uid}]: ${err.message}`), uid);
				return;
			}

			this.emit("processStarted", uid, proc);
		});
	}

	public stopProcess(uid: string): void {
		if (!this.connected) {
			this.emit("error", new Error("Not connected to PM2. Process stop aborted."));
			return;
		}

		pm2.delete(uid, async (err, proc) => {
			if (err) {
				this.emit("error", new Error(`Failed to stop process [${uid}]: ${err.message}`), uid);
				return;
			}

			this.emit("processStopped", uid, proc);

			// Optionally check and disconnect if no more processes
			await this.checkAndDisconnectIfNoProcesses();
		});
	}

	public addProcessListener(event: string, callback: (...args: any[]) => void): void {
		this.on(event, callback);
	}

	public disconnect(): void {
		if (this.connected) {
			pm2.disconnect();
			this.connected = false;
			this.emit("disconnected");
		}
	}

	public isConnected(): boolean {
		return this.connected;
	}

	public async checkAndDisconnectIfNoProcesses(): Promise<void> {
		if (!this.connected) return;

		return new Promise((resolve) => {
			pm2.list((err, processList) => {
				if (err) {
					console.error("Error fetching PM2 process list:", err);
					return resolve();
				}

				if (processList.length === 0) {
					this.disconnect();
					console.log("No PM2 processes running. Disconnected from PM2.");
				}

				resolve();
			});
		});
	}
}

export default ProcessManager;

// const procManager = new ProcessManager();

// const uid: string = "uid-01";
// const script: any = "appium --port 4723 --base-path /wd/hub";

// procManager.addProcessListener("processEvent", (...args: any[]) => {
// 	console.log("event", args[0].event);
// });

// procManager.addListener("connected", (...args: any[]) => {
// 	console.log("connected", args);

// 	// Start a process with dummy process configuration.
// 	// Replace "./someScript.js" with an actual script path if needed.
// 	procManager.startProcess(
// 		{
// 			script: script, // dummy script, ensure this file exists or mock it
// 			args: ["--test"],
// 			env: { NODE_ENV: "test" },
// 		},
// 		uid
// 	);
// });

// procManager.on("processStarted", (processUid: string, proc: any) => {
// 	try {
// 		console.log("processStarted", processUid);
// 	} catch (error) {}
// });
