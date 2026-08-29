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

	emulator.add_listener("emulator-ready", function () {
		if (loadingOverlay) loadingOverlay.style.display = "none";
	});
}