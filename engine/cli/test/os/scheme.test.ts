import { describe, expect, it } from "vitest";
import { appPath, desktopPath, KEY, registerScheme, unregisterScheme } from "../../src/os/scheme.js";
import { fakeShell } from "./support.js";

const LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/**
 * W5-D13. One machine, three operating systems: the exact commands and the
 * exact file contents, because a registration that is subtly wrong fails
 * silently — the link does nothing and there is nobody to tell.
 */
describe("harness:// registration (W5-D13)", () => {
	it("mac_registers_an_applet_and_tells_launch_services", async () => {
		const os = fakeShell("darwin");
		const said = await registerScheme(os);
		const app = appPath(os);
		expect(app).toBe("/home/dana/Applications/Harness.app");

		// macOS delivers a URL as an Apple Event, so the handler is an applet
		// whose `on open location` calls this CLI back — node and script both
		// absolute, because LaunchServices carries none of the person's PATH.
		expect(os.files["/tmp/harness-open-x/harness-url.applescript"].body).toBe(
			"on open location theURL\n\tdo shell script \"'/opt/node/bin/node' '/opt/harness/dist/cli.js' open \" & quoted form of theURL\nend open location\n",
		);
		expect(os.calls).toEqual([
			{ file: "osacompile", args: ["-o", app, "/tmp/harness-open-x/harness-url.applescript"] },
			{ file: "plutil", args: ["-replace", "CFBundleIdentifier", "-string", "co.harness.cli", `${app}/Contents/Info.plist`] },
			{
				file: "plutil",
				args: ["-replace", "CFBundleURLTypes", "-json", '[{"CFBundleURLName":"Harness","CFBundleURLSchemes":["harness"]}]', `${app}/Contents/Info.plist`],
			},
			{ file: LSREGISTER, args: ["-f", app] },
		]);
		expect(os.removed).toContain(app); // an older bundle is replaced, not merged
		expect(said[0]).toContain(app);
	});

	it("mac_unregister_takes_the_app_off_the_machine", async () => {
		const os = fakeShell("darwin");
		await unregisterScheme(os);
		expect(os.calls).toEqual([{ file: LSREGISTER, args: ["-u", appPath(os)] }]);
		expect(os.removed).toEqual([appPath(os)]);
	});

	it("windows_writes_the_class_under_hkcu", async () => {
		const os = fakeShell("win32");
		await registerScheme(os);
		expect(KEY).toBe("HKCU\\Software\\Classes\\harness");
		expect(os.calls).toEqual([
			{ file: "reg", args: ["add", KEY, "/ve", "/d", "URL:Harness", "/f"] },
			{ file: "reg", args: ["add", KEY, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"] },
			{
				file: "reg",
				args: ["add", `${KEY}\\shell\\open\\command`, "/ve", "/d", '"C:\\Program Files\\nodejs\\node.exe" "C:\\harness\\dist\\cli.js" open "%1"', "/f"],
			},
		]);
		// Nothing machine-wide: HKCU alone, so no registration needs a password.
		expect(os.calls.every((call) => call.args.every((arg) => !arg.startsWith("HKLM")))).toBe(true);

		os.calls.length = 0;
		await unregisterScheme(os);
		expect(os.calls).toEqual([{ file: "reg", args: ["delete", KEY, "/f"] }]);
	});

	it("linux_writes_a_desktop_file_and_makes_it_the_handler", async () => {
		const os = fakeShell("linux");
		os.present.add("update-desktop-database");
		await registerScheme(os);
		expect(desktopPath(os)).toBe("/home/dana/.local/share/applications/harness.desktop");
		expect(os.files[desktopPath(os)].body).toBe(
			[
				"[Desktop Entry]",
				"Type=Application",
				"Name=Harness",
				"Comment=Open a harness session from the console",
				"Exec=/opt/node/bin/node /opt/harness/dist/cli.js open %u",
				"Terminal=false",
				"NoDisplay=true",
				"MimeType=x-scheme-handler/harness;",
				"",
			].join("\n"),
		);
		expect(os.calls).toEqual([
			{ file: "xdg-mime", args: ["default", "harness.desktop", "x-scheme-handler/harness"] },
			{ file: "update-desktop-database", args: ["/home/dana/.local/share/applications"] },
		]);
	});

	it("linux_skips_update_desktop_database_when_it_is_not_installed", async () => {
		const os = fakeShell("linux");
		await registerScheme(os);
		expect(os.calls.map((call) => call.file)).toEqual(["xdg-mime"]);
		os.calls.length = 0;
		await unregisterScheme(os);
		expect(os.calls).toEqual([]);
		expect(os.removed).toEqual([desktopPath(os)]);
	});
});
