"use strict";

const TERMS_STORAGE_KEY = "browser7_terms_accepted";
const DB_NAME = "browser7_storage";
const DB_VERSION = 1;
const STORE_NAME = "savestates";

function openDatabase() {
	return new Promise((resolve, reject) => {
		if (!window.indexedDB) {
			return reject(new Error("IndexedDB is not supported in this browser"));
		}

		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = function (event) {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};

		request.onsuccess = function (event) {
			resolve(event.target.result);
		};

		request.onerror = function (event) {
			reject(event.target.error || new Error("Failed to open IndexedDB"));
		};
	});
}

/**
 * Retrieve a cached savestate ArrayBuffer from IndexedDB by key.
 */
async function getCachedState(key) {
	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const req = store.get(key);

			req.onsuccess = async () => {
				const result = req.result;
				if (!result) return resolve(null);

				if (result instanceof ArrayBuffer) {
					return resolve(result);
				}
				if (result instanceof Blob) {
					return resolve(await result.arrayBuffer());
				}
				if (result.buffer instanceof ArrayBuffer) {
					return resolve(result.buffer);
				}

				resolve(null);
			};

			req.onerror = () => resolve(null);
		});
	} catch (err) {
		console.warn("Failed to retrieve cached savestate from IndexedDB:", err);
		return null;
	}
}

async function setCachedState(key, buffer) {
	try {
		const db = await openDatabase();
		return new Promise((resolve) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const req = store.put(buffer, key);

			req.onsuccess = () => resolve(true);
			req.onerror = (e) => {
				console.warn("Failed to store savestate in IndexedDB:", e);
				resolve(false);
			};
		});
	} catch (err) {
		console.warn("Failed to open IndexedDB for caching:", err);
		return false;
	}
}

/**
 * Download the savestate using XMLHttpRequest with progress reporting.
 */
function downloadSavestateWithProgress(url, fallbackSize, onProgress) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url, true);
		xhr.responseType = "arraybuffer";

		xhr.onprogress = function (event) {
			const total = event.lengthComputable && event.total ? event.total : (fallbackSize || 0);
			onProgress(event.loaded, total);
		};

		xhr.onload = function () {
			if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
				resolve(xhr.response);
			} else {
				reject(new Error(`HTTP status ${xhr.status}`));
			}
		};

		xhr.onerror = function () {
			reject(new Error("Network error occurred while downloading savestate"));
		};

		xhr.send();
	});
}

function initEmulator(config) {
	const licenseScreen = document.getElementById("license_screen");
	const agreeCheckbox = document.getElementById("agree_checkbox");
	const acceptButton = document.getElementById("accept_button");
	const diskInput = document.getElementById("disk_image_input");
	const savestateInput = document.getElementById("savestate_input");

	if (diskInput && config.hdaUrl) {
		diskInput.value = config.hdaUrl;
	}
	if (savestateInput && config.stateUrl) {
		savestateInput.value = config.stateUrl;
	}

	const termsAccepted = localStorage.getItem(TERMS_STORAGE_KEY) === "true";

	if (termsAccepted) {
		if (licenseScreen) {
			licenseScreen.style.display = "none";
		}
		boot(config, diskInput ? diskInput.value : config.hdaUrl, savestateInput ? savestateInput.value : config.stateUrl);
	} else {
		if (licenseScreen) {
			licenseScreen.style.display = "flex";
		}

		if (agreeCheckbox && acceptButton) {
			agreeCheckbox.addEventListener("change", function () {
				acceptButton.disabled = !this.checked;
			});

			acceptButton.addEventListener("click", function () {
				if (!agreeCheckbox.checked) return;

				const diskPath = diskInput.value.trim();
				const savestatePath = savestateInput.value.trim();

				if (!diskPath.startsWith("http")) {
					alert("Disk image path is invalid!");
					return;
				}
				if (!savestatePath.startsWith("http")) {
					alert("Savestate path is invalid!");
					return;
				}

				localStorage.setItem(TERMS_STORAGE_KEY, "true");
				licenseScreen.style.display = "none";

				boot(config, diskPath, savestatePath);
			});
		}
	}
}

async function boot(config, diskPath, savestatePath) {
	const loadingOverlay = document.getElementById("loading_overlay");
	const loadingProgress = document.getElementById("loading_progress");
	const loadingStatus = document.getElementById("loading_status");
	const bootAnim = document.getElementById("boot_anim");

	if (bootAnim && config.bootAnim) {
		bootAnim.src = config.bootAnim;
		bootAnim.style.display = "block";
	}

	if (loadingStatus) {
		loadingStatus.textContent = "Checking cache...";
	}

	let stateBuffer = null;

	try {
		stateBuffer = await getCachedState(savestatePath);
	} catch (e) {
		console.warn("Cache lookup error:", e);
	}

	if (stateBuffer) {
		if (loadingStatus) {
			loadingStatus.textContent = "Loading saved state from storage...";
		}
		if (loadingProgress) {
			loadingProgress.value = 100;
		}
	} else {
		try {
			if (loadingStatus) {
				loadingStatus.textContent = "Downloading data... 0.0%";
			}

			stateBuffer = await downloadSavestateWithProgress(
				savestatePath,
				config.stateSize,
				function (loaded, total) {
					if (total > 0) {
						const progress = (loaded / total) * 100;
						const loadedMB = (loaded / 1024 / 1024).toFixed(1);
						const totalMB = (total / 1024 / 1024).toFixed(1);

						if (loadingProgress) loadingProgress.value = progress;
						if (loadingStatus) loadingStatus.textContent = `Downloading data... ${progress.toFixed(1)}% (${loadedMB} / ${totalMB} MB)`;
					} else {
						const loadedMB = (loaded / 1024 / 1024).toFixed(1);
						if (loadingStatus) loadingStatus.textContent = `Downloading data... (${loadedMB} MB)`;
					}
				}
			);

			setCachedState(savestatePath, stateBuffer).catch((err) => {
				console.warn("Could not cache savestate:", err);
			});
		} catch (err) {
			console.error("Savestate download failed:", err);
			if (loadingStatus) {
				loadingStatus.textContent = `Download failed: ${err.message}`;
			}
			return;
		}
	}

	if (loadingStatus) {
		loadingStatus.textContent = "Starting emulator...";
	}

	const v86Config = {
		wasm_path: config.wasmPath,
		memory_size: config.memorySize,
		vga_memory_size: config.vgaMemorySize,
		screen_container: document.getElementById("screen_container"),
		bios: {
			url: "/build/seabios.bin",
		},
		vga_bios: {
			url: "/build/vgabios.bin",
		},
		hda: {
			url: diskPath,
			async: true,
			size: config.hdaSize
		},
		autostart: true,
		acpi: true,
		initial_state: {
			buffer: stateBuffer
		}
	};

	if (config.networkRelayUrl) {
		v86Config.network_relay_url = config.networkRelayUrl;
		v86Config.net_device = config.netDevice || { type: "ne2k" };
		v86Config.preserve_mac_from_state_image = !!config.preserveMac;
	}

	const emulator = window.emulator = new V86(v86Config);

	createVMUI(emulator);

	emulator.add_listener("emulator-ready", function () {
		if (loadingOverlay) loadingOverlay.style.display = "none";
	});
}

function createVMUI(emulator) {
	const fa = document.createElement("link");
	fa.rel = "stylesheet";
	fa.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
	document.head.appendChild(fa);

	const vmWindow = document.createElement("div");
	vmWindow.id = "vm-window";
	
	const toolbar = document.createElement("div");
	toolbar.id = "vm-toolbar";

	const screenWrapper = document.createElement("div");
	screenWrapper.id = "vm-screen-wrapper";

	const statusbar = document.createElement("div");
	statusbar.id = "vm-statusbar";

	const screenContainer = document.getElementById("screen_container");
	document.body.insertBefore(vmWindow, screenContainer);
	vmWindow.appendChild(toolbar);
	vmWindow.appendChild(screenWrapper);
	vmWindow.appendChild(statusbar);
	screenWrapper.appendChild(screenContainer);

	function addBtn(icon, text, title, onClick) {
		const btn = document.createElement("button");
		btn.className = "toolbar-btn";
		btn.title = title;
		btn.innerHTML = `<i class="${icon}"></i> ${text}`;
		btn.onclick = onClick;
		toolbar.appendChild(btn);
		return btn;
	}

	function addSep() {
		const sep = document.createElement("div");
		sep.className = "toolbar-separator";
		toolbar.appendChild(sep);
	}


	let isPaused = false;
	const pauseBtn = addBtn("fa-solid fa-pause", "Pause", "Pause / Resume", () => {
		if (isPaused) {
			emulator.run();
			pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
			isPaused = false;
		} else {
			emulator.stop();
			pauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
			isPaused = true;
		}
	});

	addSep();

	addBtn("fa-solid fa-keyboard", "Ctrl+Alt+Del", "Send Ctrl+Alt+Del", () => {
		emulator.keyboard_send_scancodes([
			0x1D, 0x38, 0x53, 0xD3, 0xB8, 0x9D
		]);
	});

	addBtn("fa-brands fa-windows", "Win Key", "Send Windows Key", () => {
		emulator.keyboard_send_scancodes([0xE0, 0x5B, 0xE0, 0xDB]);
	});

	// Paste Text
	addBtn("fa-solid fa-paste", "Paste", "Paste Text to VM", () => {
		const text = prompt("Enter text to paste to VM:");
		if (text) {
			emulator.keyboard_send_text(text);
		}
	});

	addSep();

	// Insert / Eject ISO (Hide on Win7 as it lacks a CD/DVD drive)
	if (!window.location.pathname.includes("win7")) {
		let isoInserted = false;
		const isoInput = document.createElement("input");
		isoInput.type = "file";
		isoInput.accept = ".iso";
		isoInput.style.display = "none";
		document.body.appendChild(isoInput);

		isoInput.addEventListener("change", (e) => {
			const file = e.target.files[0];
			if (file) {
				emulator.set_cdrom({ buffer: file });
				isoBtn.innerHTML = '<i class="fa-solid fa-eject"></i> Eject ISO';
				isoInserted = true;
			}
		});

		const isoBtn = addBtn("fa-solid fa-compact-disc", "Insert ISO", "Insert or Eject CD/DVD", () => {
			if (isoInserted) {
				emulator.eject_cdrom();
				isoBtn.innerHTML = '<i class="fa-solid fa-compact-disc"></i> Insert ISO';
				isoInserted = false;
				isoInput.value = "";
			} else {
				isoInput.click();
			}
		});

		addSep();
	}

	addBtn("fa-solid fa-save", "Save State", "Download VM State", async () => {
		const state = await emulator.save_state();
		const a = document.createElement("a");
		a.download = "browser7_state.bin";
		a.href = window.URL.createObjectURL(new Blob([state]));
		a.click();
	});

	const stateInput = document.createElement("input");
	stateInput.type = "file";
	stateInput.accept = ".bin";
	stateInput.style.display = "none";
	document.body.appendChild(stateInput);

	stateInput.addEventListener("change", async (e) => {
		const file = e.target.files[0];
		if (file) {
			const buffer = await file.arrayBuffer();
			emulator.restore_state(buffer);
		}
	});

	addBtn("fa-solid fa-upload", "Load State", "Upload VM State", () => {
		stateInput.click();
	});

	addSep();

	addBtn("fa-solid fa-camera", "Screenshot", "Take Screenshot", () => {
		const img = emulator.screen_make_screenshot();
		if (img && img.src) {
			const a = document.createElement("a");
			a.download = "browser7_screenshot.png";
			a.href = img.src;
			a.click();
		}
	});

	addBtn("fa-solid fa-expand", "Fullscreen", "Toggle Fullscreen", () => {
		emulator.screen_go_fullscreen();
	});

	const spacer = document.createElement("div");
	spacer.style.flex = "1";
	toolbar.appendChild(spacer);

	addBtn("fa-solid fa-house", "Home", "Back to Home", () => {
		window.location.href = "/";
	});

	statusbar.innerHTML = `
		<div class="status-item" title="Disk Activity">
			<i class="fa-solid fa-hard-drive"></i>
			<div class="led" id="led-disk"></div>
		</div>
		<div class="status-item" title="Network Activity">
			<i class="fa-solid fa-network-wired"></i>
			<div class="led" id="led-net"></div>
		</div>
		<div class="status-item" title="Instruction Speed" style="min-width: 80px; justify-content: flex-end;">
			<span id="mips-counter">0 MIPS</span>
		</div>
	`;

	let diskTimeout;
	const ledDisk = document.getElementById("led-disk");
	function blinkDisk(color) {
		if (!ledDisk) return;
		ledDisk.className = `led ${color}`;
		clearTimeout(diskTimeout);
		diskTimeout = setTimeout(() => { ledDisk.className = "led"; }, 50);
	}

	let netTimeout;
	const ledNet = document.getElementById("led-net");
	function blinkNet(color) {
		if (!ledNet) return;
		ledNet.className = `led ${color}`;
		clearTimeout(netTimeout);
		netTimeout = setTimeout(() => { ledNet.className = "led"; }, 50);
	}

	emulator.add_listener("ide-read-start", () => blinkDisk("green"));
	emulator.add_listener("ide-read-end", () => blinkDisk("green"));
	emulator.add_listener("ide-write-end", () => blinkDisk("red"));
	
	emulator.add_listener("net0-receive", () => blinkNet("green"));
	emulator.add_listener("net0-send", () => blinkNet("red"));

	let lastCounter = 0;
	setInterval(() => {
		if (!emulator.is_running()) return;
		const current = emulator.get_instruction_counter();
		const diff = current - lastCounter;
		lastCounter = current;
		const mips = (diff / 1000000).toFixed(1);
		document.getElementById("mips-counter").textContent = `${mips} MIPS`;
	}, 1000);
}
