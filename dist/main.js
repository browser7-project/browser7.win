"use strict";

function saveArrayBufferAsFile(arrayBuffer, fileName, mimeType) {
	const blob = new Blob([arrayBuffer], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

async function saveState() {
	saveArrayBufferAsFile(await emulator.save_state(), "savestate.bin", "text/plain")
}

function startEmulator(diskPath, savestate) {
	const loadingOverlay = document.getElementById("loading_overlay");
	const loadingProgress = document.getElementById("loading_progress");
	const loadingStatus = document.getElementById("loading_status");

	var emulator = window.emulator = new V86({
		wasm_path: "v86.wasm",
		memory_size: 256 * 1024 * 1024,
		vga_memory_size: 32 * 1024 * 1024,
		screen_container: document.getElementById("screen_container"),
		bios: {
			url: "seabios.bin",
		},
		vga_bios: {
			url: "vgabios.bin",
		},
		hda: {
			url: diskPath,
			async: true,
			size: 3865051136
		},
		autostart: true,
		acpi: true,
		initial_state: {
			url: savestate,
			size: 64520648
		}
	});

	emulator.add_listener("download-progress", function (event) {
		if (event.file_name.includes("4_zf0e386b7a1df37119e870a10_f1090cce9eff9d94b_d20250722_m114357_c003_v0312029_t0053_u01753184637701")) {
			const progress = (event.loaded / event.total) * 100;
			const loadedMB = (event.loaded / 1024 / 1024).toFixed(1);
			const totalMB = (event.total / 1024 / 1024).toFixed(1);

			loadingProgress.value = progress;
			loadingStatus.textContent = `Downloading data... ${progress.toFixed(1)}% (${loadedMB} / ${totalMB} MB)`;
		}
	});

	emulator.add_listener("emulator-ready", function () {
		loadingOverlay.style.display = "none";
	});
}

function startEmulatorButton() {
	const cb1 = document.getElementById("agree1_checkbox");
	const cb2 = document.getElementById("agree2_checkbox");
	const path = document.getElementById("disk_image_input");
	const savestate_input = document.getElementById("savestate_input");

	if (!cb1.checked) {
		alert("You MUST read, understand, and agree to the Legal Notice and Terms of Use.");
		return;
	}

	if (!cb2.checked) {
		alert("You MUST affirm that you own a legitimate license for the software you will load.");
		return;
	}

	if (!path.value.startsWith("https://")) {
		alert("Disk image path is invalid!");
		return;
	}

	if (!savestate_input.value.startsWith("https://")) {
		alert("Savestate path is invalid!");
		return;
	}

	document.getElementById("legal_disclaimer").remove();

	startEmulator(path.value, savestate_input.value);
}