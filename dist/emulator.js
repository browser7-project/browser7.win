"use strict";

const TERMS_STORAGE_KEY = "browser7_terms_accepted";

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

function boot(config, diskPath, savestatePath) {
	const loadingOverlay = document.getElementById("loading_overlay");
	const loadingProgress = document.getElementById("loading_progress");
	const loadingStatus = document.getElementById("loading_status");
	const bootAnim = document.getElementById("boot_anim");

	if (bootAnim && config.bootAnim) {
		bootAnim.src = config.bootAnim;
		bootAnim.style.display = "block";
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
			url: savestatePath,
			size: config.stateSize
		}
	};

	if (config.networkRelayUrl) {
		v86Config.network_relay_url = config.networkRelayUrl;
		v86Config.net_device = config.netDevice || { type: "ne2k" };
		v86Config.preserve_mac_from_state_image = !!config.preserveMac;
	}

	const emulator = window.emulator = new V86(v86Config);

	emulator.add_listener("download-progress", function (event) {
		if (event.file_name === savestatePath) {
			const progress = (event.loaded / event.total) * 100;
			const loadedMB = (event.loaded / 1024 / 1024).toFixed(1);
			const totalMB = (event.total / 1024 / 1024).toFixed(1);

			if (loadingProgress) loadingProgress.value = progress;
			if (loadingStatus) loadingStatus.textContent = `Downloading data... ${progress.toFixed(1)}% (${loadedMB} / ${totalMB} MB)`;
		}
	});

	emulator.add_listener("emulator-ready", function () {
		if (loadingOverlay) loadingOverlay.style.display = "none";
	});
}