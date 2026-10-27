import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../db/database';
import { CacheRepository } from '../../db/repositories/cacheRepository';
import { ApiCache } from '../apiCache';
import type { FetchFn } from '../http';
import { CATALOG_SCHEMA_VERSION, parseCatalog, pickAsset } from './catalogSchema';
import { StoreCatalogService } from './catalogService';
import { GITHUB_TOKEN_PATTERN } from '@shared/store';
import { GitHubClient } from './githubClient';
import { SEED_CATALOG } from './seedCatalog';

// Nomes reais dos arquivos publicados (conferidos na API do GitHub em 23/10/2026).
const REAL_ASSETS: Record<string, string[]> = {
  shipwright: ['SoH-Dewey-Bravo-Mac.zip', 'SoH-Dewey-Bravo-Win64.zip', 'SoH-Dewey-Bravo.appimage'],
  '2ship2harkinian': ['2Ship-Battler-Bravo-Linux.zip', '2Ship-Battler-Bravo-Mac.zip', '2Ship-Battler-Bravo-Win64.zip'],
  starship: ['Starship-Barnard-Alfa-Linux.zip', 'Starship-Barnard-Alfa-Switch.zip', 'Starship-Barnard-Alfa-Windows.zip'],
  spaghettikart: ['spaghetti-linux.zip', 'spaghetti-mac-arm64.zip', 'spaghetti-mac-intel-x64.zip', 'spaghetti-windows.zip'],
  zelda64recomp: [
    'Zelda64Recompiled-v1.2.2-Linux-ARM64.zip',
    'Zelda64Recompiled-v1.2.2-Linux-Flatpak-X64.zip',
    'Zelda64Recompiled-v1.2.2-macOS.zip',
    'Zelda64Recompiled-v1.2.2-Windows.zip',
  ],
  'perfect-dark': ['pd-arm64-nswitch.zip', 'pd-i686-windows.zip', 'pd-x86_64-linux.tar.gz', 'pd-x86_64-windows.zip'],
  sm64coopdx: ['sm64coopdx_Linux.zip', 'sm64coopdx_macOS_ARM.zip', 'sm64coopdx_SteamOS.zip', 'sm64coopdx_Windows.zip'],
  unleashedrecomp: ['UnleashedRecomp-Flatpak.zip', 'UnleashedRecomp-Windows.zip'],
  banjorecomp: ['BanjoRecompiled-v1.0.2-Linux-X64.tar.gz', 'BanjoRecompiled-v1.0.2-macOS.zip', 'BanjoRecompiled-v1.0.2-Windows.zip'],
  // Lote 4 (conferidos em 23/10/2026).
  'conker-reloaded': [
    'ConkerBFDReloaded-HD-Icons-French-v1.3.5.rtz',
    'ConkerBFDReloaded-HD-Icons-v1.3.3.rtz',
    'ConkerBFDReloaded-v1.4.6-Linux.tar.gz',
    'ConkerBFDReloaded-v1.4.6-Windows.zip',
  ],
  dusklight: ['Dusklight-v2.0.3-linux-x86_64.AppImage', 'Dusklight-v2.0.3-macos-x86_64.zip', 'Dusklight-v2.0.3-win32-arm64.zip', 'Dusklight-v2.0.3-win32-x86_64.zip'],
  ghostship: ['Nautilus-Alfa-Android.zip', 'Nautilus-Alfa-Linux.zip', 'Nautilus-Alfa-Mac.zip', 'Nautilus-Alfa-Win64.zip'],
  'dk64-recompiled': [
    'DK64Recompiled-Flatpak-X64-Release-1-0-3.zip',
    'DK64Recompiled-Linux-X64-Release-1-0-3.zip',
    'DK64Recompiled-macOS-ARM64-Release-1-0-3.zip',
    'DK64Recompiled-Windows-Release-1-0-3.zip',
  ],
  'golden-balloon': [
    'Golden-Balloon-1.8.0-linux-x86_64.tar.gz',
    'Golden-Balloon-1.8.0-windows-x64.zip.provenance.json',
    'Golden-Balloon-1.8.0-windows-x64.zip.sha256',
    'Golden-Balloon-1.8.0-windows-x64.zip',
  ],
  'project-midas': ['ProjectMidas-v1.0.1-linux.7z', 'ProjectMidas-v1.0.1-steamdeck.7z', 'ProjectMidas-v1.0.1-windows.7z'],
  'metroid-prime-port': ['metroid-prime-port-0.32.0-macos-arm64.zip', 'metroid-prime-port-0.32.0-windows-arm64.zip', 'metroid-prime-port-0.32.0-windows-x86_64.zip'],
  strikers: ['SHA256SUMS', 'strikers-linux-arm64.tar.gz', 'strikers-switch.zip', 'strikers-windows-x86_64.zip'],
  recharged: ['recharged-1.0.14+g0bec25b45c99-steamdeck-x86_64.tar.gz', 'recharged-1.0.14+g0bec25b45c99-windows-x86_64.zip', 'SHA256SUMS'],
  'sms-launcher': ['latest.yml', 'SMS-Launcher-0.1.64-mac-universal.zip', 'SMS-Launcher-0.1.64-win-portable.exe', 'SMS-Launcher-Setup-0.1.64.exe'],
  // Lote 5 (conferidos em 23/10/2026).
  'symphony-recomp': ['SymphonyRecomp-v0.5.1b-linux-x64.tar.gz', 'SymphonyRecomp-v0.5.1b-macos-x64.zip', 'SymphonyRecomp-v0.5.1b-windows-arm64.zip', 'SymphonyRecomp-v0.5.1b-windows-x64.zip'],
  'medievil-recomp': ['MediEvilRecomp-v0.2b-macos-x64.zip', 'MediEvilRecomp-v0.2b-windows-arm64.zip', 'MediEvilRecomp-v0.2b-windows-x64.zip'],
  'castlevania-chronicles': ['CastlevaniaChronicles-0.3.10-linux-x64.tar.gz', 'CastlevaniaChronicles-0.3.10-osx-arm64.zip', 'CastlevaniaChronicles-0.3.10-win-x64.zip', 'SHA256SUMS-0.3.10.txt'],
  'tenkaichi3-decomp': ['Tenkaichi3Decomp-linux-x64.zip', 'Tenkaichi3Decomp-windows-x64.zip'],
  trx: ['TRX-1.11.1-Linux.zip', 'TRX-1.11.1-Mac.dmg', 'TRX-1.11.1-TombEditor.zip', 'TRX-1.11.1-Windows.zip', 'TRX-1.11.1-Windows_Installer.exe'],
  uzdoom: ['Linux-UZDoom-Release-x86_64.AppImage', 'MacOS-UZDoom-Release-ARM64.dmg', 'Windows-UZDoom-Release-x86_64.zip', '_release.json'],
  opengoal: [
    'OpenGOAL-Launcher_2.11.2_x64.dmg',
    'OpenGOAL-Launcher_2.11.2_x64_en-US.msi.sig',
    'OpenGOAL-Launcher_2.11.2_x64_en-US.msi.zip',
    'OpenGOAL-Launcher_2.11.2_x64_en-US.msi',
  ],
  'lost-odyssey-recomp': ['LostOdysseyRecomp-android-arm64-v1.0.6.apk', 'LostOdysseyRecomp-linux-x64-v1.0.6.AppImage', 'LostOdysseyRecomp-windows-x64-v1.0.6.zip'],
  'bloodborne-pc': ['fsr4vk-v0.4.3-amdfix-src.zip', 'Bloodborne-Windows.zip'],
  // Lote 6 (conferidos em 23/10/2026).
  takedawn: ['BUILDINFO', 'SHA256SUMS', 'Takedawn-0.2.1-android-arm64.apk', 'Takedawn-0.2.1-linux-x86_64.AppImage', 'Takedawn-0.2.1-windows-x64-setup.exe'],
  'ring-out': ['RingOut-1.6.10-linux-x86_64.zip', 'RingOut-1.6.10-steamdeck-x86_64.zip', 'RingOut-1.6.10-windows-x64-setup.exe', 'RingOut-1.6.10-windows-x64.zip'],
  'pt-pc': ['P.T.PC.Port-macOS-x64.zip', 'P.T.PC.Port-portable-linux.zip', 'P.T.PC.Port-portable-windows.zip'],
  octr: ['CTR-NitroFueled-PC-portable-v0.6.4-windows.zip', 'SacredFire-v0.6.4-x86_64.AppImage'],
  'king-kong-recompiled': ['KingKong-v1.9.13-windows-x64.zip', 'king_kong.map'],
  yakumo: ['ffmpeg-7.1.5.tar.xz', 'SHA256SUMS-windows.txt', 'yakumo-0.7.5-windows-x86_64.zip', 'yakumo-0.7.5-windows-x86_64-portable.zip'],
  'lantern-engine': ['Bloodborne.Launcher.exe', 'Lantern.Engine.exe', 'LanternEngine-v0.9.37-linux-x64.tar.gz', 'LanternEngine-v0.9.37-win64.zip', 'package.json'],
  // Lote 7 (conferidos em 23/10/2026).
  'wind-waker-hd-recomp': ['SHA256SUMS.txt', 'vt-report.json', 'WindWakerHD-v0.4.0-linux-x86_64.zip', 'WindWakerHD-v0.4.0-windows-arm64.zip', 'WindWakerHD-v0.4.0-windows-x86_64.zip'],
  'wwe-all-stars-recomp': ['WWEAllStarsRecomp-1.5.0-eec7b22-win-x64.zip.sha256', 'WWEAllStarsRecomp-1.5.0-eec7b22-win-x64.zip'],
  'yugioh-fm-recompiled': [
    'fm-editor-v0.3.0-linux.tar.gz',
    'fm-editor-v0.3.0-windows.zip',
    'yfm-redecomp-hd-mod-v0.3.0.zip',
    'yfm-redecomp-v0.3.0-macos-arm64.zip',
    'yfm-redecomp-v0.3.0-windows.zip',
  ],
  opencmr2: ['OpenCMR2-Android.apk', 'OpenCMR2-Linux-x86_64.tar.gz', 'OpenCMR2-Windows-x64.zip.sha256', 'OpenCMR2-Windows-x64.zip'],
  verdite2: ['Verdite2-0.5.1-win-x64-setup.exe', 'Verdite2-0.5.1-win-x64.zip', 'Verdite2-0.5.1-x86_64.AppImage'],
  'hydro-thunder-port': ['Hydro-Thunder-Windows-revisao-9.1.0.zip', 'HydroThunder-revisao-9.1.0.AppImage', 'SHA256-revisao-9.1.0.txt'],
  'uncharted-ndc': ['Uncharted-windows.zip'],
  'second-hunt': ['SecondHunt-0.3.8-beta-update.txt', 'SecondHunt-0.3.8-beta-windows-x64.zip.sha256', 'SecondHunt-0.3.8-beta-windows-x64.zip', 'SecondHunt-0.3.8-beta.apk'],
  'goldeneye-pc-port': ['goldeneye-pc-port-0.5.0-linux-x86_64.tar.gz', 'goldeneye-pc-port-0.5.0-win64.zip.sha256', 'goldeneye-pc-port-0.5.0-win64.zip'],
  spartanport: ['spartanport-windows.zip', 'spartanport-windows.zip.sha256', 'spartanport-x86_64.AppImage', 'spartanport-x86_64.AppImage.sha256'],
  'edge-of-time-recomp': [
    'EdgeOfTimeRecomp-v1.0.0-20261004_2039-mac-arm64.dmg',
    'EdgeOfTimeRecomp-v1.0.0-20261004_2039-mac-arm64.zip',
    'EdgeOfTimeRecomp-v1.0.0-20261004_2039-win-amd64.zip',
    'EdgeOfTimeRecomp-v1.0.0-20261004_2040-x86_64.AppImage',
  ],
  renut: ['renut-x86_64.AppImage', 'renut.zip'],
  nebula: ['Nebula-Setup.exe', 'Nebula-Setup.exe.sig'],
  'alien-resurrection-recomp': ['AlienResurrection-0.1.6-linux-x86_64.tar.gz', 'AlienResurrection-0.1.6-macos.zip', 'AlienResurrection-0.1.6-windows-x64.zip'],
  'ttt2-pc': ['ttt2-server-0.1.7-linux-amd64.tar.gz', 'ttt2-server-0.1.7-linux-arm64.tar.gz', 'ttt2-server-0.1.7-windows-amd64.zip', 'ttt2_setup.exe'],
  dekui: ['Dekui-1.0.0-Linux-x86_64.tar.gz', 'Dekui-1.0.0-macOS-arm64.zip', 'Dekui-1.0.0-Source.zip', 'Dekui-1.0.0-Windows-x64.zip'],
  'new-super-paper-bros': ['NewSuperPaperBros-linux.tar.gz', 'NewSuperPaperBros.zip'],
  'nsmbu-recomp': [
    'NSMBU-v0.5.0-linux-aarch64.AppImage',
    'NSMBU-v0.5.0-linux-aarch64.zip',
    'NSMBU-v0.5.0-linux-x86_64.AppImage',
    'NSMBU-v0.5.0-linux-x86_64.zip',
    'NSMBU-v0.5.0-macos-arm64.zip',
    'NSMBU-v0.5.0-windows-x86_64.zip',
    'SHA256SUMS.txt',
  ],
  athelas: ['Athelas-1.5-arm64.zip', 'Athelas-1.5-arm64.zip.sha256', 'Athelas-1.5.zip', 'Athelas-1.5.zip.sha256'],
  'rush2-recompiled': ['Rush2Recompiled-1.0.31-x86_64.AppImage', 'Rush2Recompiled-1.0.31.zip'],
  fukami: ['Fukami-1.1.0-linux-x86_64.tar.gz', 'Fukami-1.1.0-macos-arm64.zip', 'Fukami-1.1.0-windows-x86_64.zip', 'SHA256SUMS'],
  clayfighter64: [
    'clayfighter64-2.0-linux-x86_64.tar.gz',
    'clayfighter64-2.0-sdk-source.tar.gz',
    'clayfighter64-2.0-source.tar.gz',
    'clayfighter64-2.0-windows-x86_64.zip',
    'SHA256SUMS',
  ],
  'dbz-burst-limit-recomp': ['DBZ-Burst-Limit-Recompiled-v0.7.2-alpha-linux.zip', 'DBZ-Burst-Limit-Recompiled-v0.7.2-alpha.zip'],
  'ico-pc': [
    'ico-pc-v0.8.5-android.apk',
    'ico-pc-v0.8.5-linux-x86_64.AppImage',
    'ico-pc-v0.8.5-linux.tar.gz',
    'ico-pc-v0.8.5-macos-arm64.zip',
    'ico-pc-v0.8.5-win-portable.zip',
    'ico-pc-v0.8.5-win.zip',
  ],
  'earthworm-jim-hd': ['EarthwormJimHD-v0.9.6-linux-x86_64.AppImage', 'EarthwormJimHD-v0.9.6-windows-x64.zip'],
  'openttd-jgrpp': [
    'openttd-jgrpp-0.73.4-linux-generic-amd64.tar.xz',
    'openttd-jgrpp-0.73.4-macos-universal.dmg',
    'openttd-jgrpp-0.73.4-windows-arm64.zip',
    'openttd-jgrpp-0.73.4-windows-win32.zip',
    'openttd-jgrpp-0.73.4-windows-win64.zip',
  ],
  opentyrian: [
    'opentyrian-v2.1.20260913-linux-x86_64.tar.gz',
    'opentyrian-v2.1.20260913-macos-universal.zip',
    'opentyrian-v2.1.20260913-windows-arm64.zip',
    'opentyrian-v2.1.20260913-windows-x86_64.zip',
  ],
  'rocket-r': ['Rocket-R-1.0.1-Android-arm64-v8a.apk', 'Rocket-R-1.0.1-Linux-x86_64-Portable.tar.gz', 'Rocket-R-1.0.1-Linux-x86_64.AppImage', 'Rocket-R-1.0.1-Windows-x64.zip'],
  openrct2: [
    'OpenRCT2-v0.5.6-linux-x86_64.AppImage',
    'OpenRCT2-v0.5.6-windows-installer-x64.exe',
    'OpenRCT2-v0.5.6-windows-portable-arm64.zip',
    'OpenRCT2-v0.5.6-windows-portable-win32.zip',
    'OpenRCT2-v0.5.6-windows-portable-x64.zip',
    'OpenRCT2-v0.5.6-windows-symbols-x64.zip',
  ],
  'open-nectar': ['nectar-linux.tar.gz', 'nectar-windows.zip', 'Open_Nectar-x86_64.AppImage', 'open_nectar_1.0.8.apk'],
  reblue: ['reblue-1.3.1-aarch64.AppImage', 'reblue-1.3.1-mac-arm64.zip', 'reblue-1.3.1-win-amd64-symbols.zip', 'reblue-1.3.1-win-amd64.zip', 'reblue-1.3.1-x86_64.AppImage'],
  'zelda3-launcher': ['Zelda_3_Launcher_v1.3.7.0.zip'],
  retip: ['retip_1.13.0_linux.tar.xz', 'retip_1.13.0_windows.zip'],
  weltall: ['Weltall-0.8.4-Linux.zip', 'Weltall-0.8.4-Windows.zip'],
  'jfg-recomp': ['JFG-1.4.0-windows-x64.inventory.json', 'JFG-1.4.0-windows-x64.sha256', 'JFG-1.4.0-windows-x64.zip'],
  'vf2-recomp': ['VirtuaFighter2Recomp-deck.tar.gz', 'VirtuaFighter2Recomp-mac.zip', 'VirtuaFighter2Recomp-windows.zip'],
  'geometry-wars-re2': [
    'GeometryWarsRetroEvolved2-v0.5.0-windows-x64.sha256',
    'GeometryWarsRetroEvolved2-v0.5.0-windows-x64.zip',
    'GeometryWarsRetroEvolved2Recompiled-v0.5.0-x86_64.AppImage',
  ],
  birdman64: ['Birdman64-android-arm64.apk', 'birdman64-linux-x64.tar.gz', 'Birdman64-windows-x64-debug-symbols.pdb', 'Birdman64-windows-x64.zip', 'SHA256SUMS-windows.txt'],
  'snap64-recomp': ['Snap64Recomp-1.1.6-linux-x86_64.tar.gz', 'Snap64Recomp-1.1.6-macos-universal.zip', 'Snap64Recomp-1.1.6-win64.zip', 'Snap64Recomp-1.1.6-win64.zip.sha256'],
  'silent-hill-pc': [
    'SHAndroid_101226b.apk',
    'SHPC-linux-x64_2026.09.27.1.tar.gz',
    'SHPC-macos-arm64_2026.09.27.1.zip',
    'SHPC_beta-2026.10.02.1_OLD.zip',
    'SHPC_beta-2026.10.12.1.zip',
    'SilentHill_Xbox_Beta_081226_3.zip',
  ],
  'ape-escape-recomp': ['ApeEscapeRecomp-v0.5.2-linux-x86_64.AppImage', 'ApeEscapeRecomp-v0.5.2-windows-x64.zip', 'ApeEscapeRecomp-v0.5.2-windows-x64.zip.sha256'],
  hwder: ['HWDER-v0.1.1-win64.zip'],
  'las-recomp': ['LAS.Recomp-beta_5-linux-x86_64.AppImage', 'LAS.Recomp-beta_5-macOS.dmg', 'LAS.Recomp-beta_5-windows.zip'],
  'pinyon-shift': ['PinyonShift-Launcher-linux-x86_64.tar.gz', 'PinyonShift-Launcher-macos-arm64.zip', 'PinyonShift-Launcher.zip'],
  devilutionx: [
    'devilutionx-switch.nro',
    'devilutionx-windows-i386.zip',
    'devilutionx-windows-x86_64.zip',
    'devilutionx-windows-xp-32bit.zip',
    'devilutionx-xbox-one-series.zip',
    'devilutionx-xbox.zip',
  ],
  'wwe2k14-pc': ['WWE2K14-PC-v1.1.0.zip'],
  'project-picori': [
    'tmc-multi-android-v0.9.6.apk',
    'tmc-multi-linux-x86_64-v0.9.6.tar.gz',
    'tmc-multi-macos-x86_64-v0.9.6.tar.gz',
    'tmc-multi-windows-arm64-v0.9.6.tar.gz',
    'tmc-multi-windows-x86_64-v0.9.6.tar.gz',
  ],
  'dragons-crown-pro-pc': [
    'DragonsCrownProPC-v0.7.1-windows-x64.zip',
    'DragonsCrownProPC-v0.7.1-windows-x64.zip.sha256',
    'DragonsCrownProPC-v0.7.1-x86_64.AppImage',
    'DragonsCrownProPC-v0.7.1-x86_64.AppImage.sha256',
  ],
  'driveclub-recomp': ['driveclub-recomp-0.3.1-win64.zip', 'SHA256SUMS.txt'],
  'infamous-second-son-pc': ['infamous-linux-x86_64.tar.gz', 'infamous-windows-x86_64.zip', 'SHA256SUMS'],
  'sotc-pc': ['SotC-PC.zip'],
  'the-last-guardian-pc': ['SHA256SUMS', 'tlg-linux-x86_64.tar.gz', 'tlg-windows-x86_64.zip'],
  'shaolin-monks-recomp': ['checksums.txt', 'ShaolinMonksRecomp-0.2.0-Linux-x64.tar.gz', 'ShaolinMonksRecomp-0.2.0-Windows-x64.zip'],
  openmw: ['openmw-0.51.0-Linux-64Bit-debug.tar.gz', 'openmw-0.51.0-Linux-64Bit.tar.gz', 'OpenMW-0.51.0-macOS-arm64.dmg', 'OpenMW-0.51.0-macOS-x86_64.dmg', 'OpenMW-0.51.0-Windows-x64.exe'],
  'atomic-bomberman-modern': [
    'atomic-bomberman-modern-linux-x86_64.tar.gz',
    'atomic-bomberman-modern-windows-x64.zip',
    'atomic-bomberman-server-linux-x86_64.tar.gz',
    'atomic-bomberman-server-windows-x64.zip',
  ],
  'urbz-recomp': ['Urbz-linux-x64.tar.zst', 'Urbz.zip'],
  'tony-was-a-pro-skater': ['thps-linux-x64-1.4.0.tar.gz', 'thps-linux-x86-1.4.0.tar.gz', 'thps-windows-x64-1.4.0.zip', 'thps-windows-x86-1.4.0.zip'],
  cybermage: ['cybermage-windows-x64.zip', 'cybermage-windows-x64.zip.sha256'],
  urbanrecomp: [
    'UrbanRecomp-enhanced-v1.0.4-android-universal.apk',
    'UrbanRecomp-enhanced-v1.0.4-linux-x64.tar.gz',
    'UrbanRecomp-enhanced-v1.0.4-macos-universal.zip',
    'UrbanRecomp-enhanced-v1.0.4-windows-x64-single.exe',
  ],
  'svr2011-pc': ['SvR2011-Android-v2.1.5.apk', 'SvR2011-Mods-v2.1.5.zip', 'SvR2011-PC-v2.1.5.zip'],
  'power-dozer': [
    'power-dozer-v0.84-linux-x86_64.tar.gz',
    'power-dozer-v0.84-source.tar.gz',
    'power-dozer-v0.84-windows-x86_64.zip',
    'power-dozer-v0.84-windows-x86_64.zip.sha256',
  ],
  'snowboard-kids-recomp': ['SnowboardKidsRecompiled-Linux-X64.tar.gz', 'SnowboardKidsRecompiled-macOS.zip', 'SnowboardKidsRecompiled-Windows.zip'],
  aerofoil: ['Aerofoil-1.1.2-android.apk', 'Aerofoil-1.1.2-win64-installpkg.msi', 'Aerofoil-1.1.2-win64-PDBs.7z', 'Aerofoil-1.1.2-win64-tools.zip', 'Aerofoil-1.1.2-win64.zip'],
  heretic2r: ['Heretic2R_R6.zip'],
};
const EXPECTED_WINDOWS: Record<string, string> = {
  shipwright: 'SoH-Dewey-Bravo-Win64.zip',
  '2ship2harkinian': '2Ship-Battler-Bravo-Win64.zip',
  starship: 'Starship-Barnard-Alfa-Windows.zip',
  spaghettikart: 'spaghetti-windows.zip',
  zelda64recomp: 'Zelda64Recompiled-v1.2.2-Windows.zip',
  'perfect-dark': 'pd-x86_64-windows.zip', // não o i686 (32 bits)
  sm64coopdx: 'sm64coopdx_Windows.zip',
  unleashedrecomp: 'UnleashedRecomp-Windows.zip',
  banjorecomp: 'BanjoRecompiled-v1.0.2-Windows.zip',
  'conker-reloaded': 'ConkerBFDReloaded-v1.4.6-Windows.zip',
  dusklight: 'Dusklight-v2.0.3-win32-x86_64.zip', // não o arm64
  ghostship: 'Nautilus-Alfa-Win64.zip',
  'dk64-recompiled': 'DK64Recompiled-Windows-Release-1-0-3.zip',
  'golden-balloon': 'Golden-Balloon-1.8.0-windows-x64.zip', // não o .zip.sha256
  'project-midas': 'ProjectMidas-v1.0.1-windows.7z',
  'metroid-prime-port': 'metroid-prime-port-0.32.0-windows-x86_64.zip', // não o arm64
  strikers: 'strikers-windows-x86_64.zip',
  recharged: 'recharged-1.0.14+g0bec25b45c99-windows-x86_64.zip',
  'sms-launcher': 'SMS-Launcher-0.1.64-win-portable.exe', // não o Setup
  'symphony-recomp': 'SymphonyRecomp-v0.5.1b-windows-x64.zip', // não o arm64
  'medievil-recomp': 'MediEvilRecomp-v0.2b-windows-x64.zip',
  'castlevania-chronicles': 'CastlevaniaChronicles-0.3.10-win-x64.zip',
  'tenkaichi3-decomp': 'Tenkaichi3Decomp-windows-x64.zip',
  trx: 'TRX-1.11.1-Windows_Installer.exe', // o instalador importa os jogos originais
  uzdoom: 'Windows-UZDoom-Release-x86_64.zip',
  opengoal: 'OpenGOAL-Launcher_2.11.2_x64_en-US.msi', // não o .msi.sig nem o .msi.zip
  'lost-odyssey-recomp': 'LostOdysseyRecomp-windows-x64-v1.0.6.zip',
  'bloodborne-pc': 'Bloodborne-Windows.zip', // não o código-fonte do FSR
  takedawn: 'Takedawn-0.2.1-windows-x64-setup.exe',
  'ring-out': 'RingOut-1.6.10-windows-x64.zip', // não o setup.exe
  'pt-pc': 'P.T.PC.Port-portable-windows.zip',
  octr: 'CTR-NitroFueled-PC-portable-v0.6.4-windows.zip',
  'king-kong-recompiled': 'KingKong-v1.9.13-windows-x64.zip',
  yakumo: 'yakumo-0.7.5-windows-x86_64-portable.zip', // não a versão que guarda dados no %APPDATA%
  'lantern-engine': 'LanternEngine-v0.9.37-win64.zip', // não os .exe soltos
  'wind-waker-hd-recomp': 'WindWakerHD-v0.4.0-windows-x86_64.zip', // não o arm64
  'wwe-all-stars-recomp': 'WWEAllStarsRecomp-1.5.0-eec7b22-win-x64.zip', // não o .sha256
  'yugioh-fm-recompiled': 'yfm-redecomp-v0.3.0-windows.zip', // o jogo, não o editor (fm-editor)
  opencmr2: 'OpenCMR2-Windows-x64.zip',
  verdite2: 'Verdite2-0.5.1-win-x64.zip', // não o setup.exe
  'hydro-thunder-port': 'Hydro-Thunder-Windows-revisao-9.1.0.zip',
  'uncharted-ndc': 'Uncharted-windows.zip',
  'second-hunt': 'SecondHunt-0.3.8-beta-windows-x64.zip',
  'goldeneye-pc-port': 'goldeneye-pc-port-0.5.0-win64.zip',
  spartanport: 'spartanport-windows.zip', // não o .sha256
  'edge-of-time-recomp': 'EdgeOfTimeRecomp-v1.0.0-20261004_2039-win-amd64.zip', // não o zip do Mac
  renut: 'renut.zip',
  nebula: 'Nebula-Setup.exe', // não a assinatura .sig
  'alien-resurrection-recomp': 'AlienResurrection-0.1.6-windows-x64.zip',
  'ttt2-pc': 'ttt2_setup.exe', // não o servidor da comunidade (ttt2-server-*.zip)
  dekui: 'Dekui-1.0.0-Windows-x64.zip', // não o Source.zip
  'new-super-paper-bros': 'NewSuperPaperBros.zip',
  'nsmbu-recomp': 'NSMBU-v0.5.0-windows-x86_64.zip',
  athelas: 'Athelas-1.5.zip', // não o arm64
  'rush2-recompiled': 'Rush2Recompiled-1.0.31.zip',
  fukami: 'Fukami-1.1.0-windows-x86_64.zip',
  clayfighter64: 'clayfighter64-2.0-windows-x86_64.zip',
  'dbz-burst-limit-recomp': 'DBZ-Burst-Limit-Recompiled-v0.7.2-alpha.zip', // não o -linux.zip
  'ico-pc': 'ico-pc-v0.8.5-win.zip',
  'earthworm-jim-hd': 'EarthwormJimHD-v0.9.6-windows-x64.zip',
  'openttd-jgrpp': 'openttd-jgrpp-0.73.4-windows-win64.zip', // não o win32 nem o arm64
  opentyrian: 'opentyrian-v2.1.20260913-windows-x86_64.zip', // não o arm64
  'rocket-r': 'Rocket-R-1.0.1-Windows-x64.zip',
  openrct2: 'OpenRCT2-v0.5.6-windows-portable-x64.zip', // não o instalador, o arm64 nem os símbolos
  'open-nectar': 'nectar-windows.zip',
  reblue: 'reblue-1.3.1-win-amd64.zip', // não os símbolos de depuração
  'zelda3-launcher': 'Zelda_3_Launcher_v1.3.7.0.zip',
  retip: 'retip_1.13.0_windows.zip',
  weltall: 'Weltall-0.8.4-Windows.zip',
  'jfg-recomp': 'JFG-1.4.0-windows-x64.zip', // não o .inventory.json nem o .sha256
  'vf2-recomp': 'VirtuaFighter2Recomp-windows.zip',
  'geometry-wars-re2': 'GeometryWarsRetroEvolved2-v0.5.0-windows-x64.zip',
  birdman64: 'Birdman64-windows-x64.zip', // não o .pdb
  'snap64-recomp': 'Snap64Recomp-1.1.6-win64.zip',
  'silent-hill-pc': 'SHPC_beta-2026.10.12.1.zip', // não o _OLD nem o de Xbox
  'ape-escape-recomp': 'ApeEscapeRecomp-v0.5.2-windows-x64.zip',
  hwder: 'HWDER-v0.1.1-win64.zip',
  'las-recomp': 'LAS.Recomp-beta_5-windows.zip',
  'pinyon-shift': 'PinyonShift-Launcher.zip',
  devilutionx: 'devilutionx-windows-x86_64.zip', // não o i386 nem o de XP
  'wwe2k14-pc': 'WWE2K14-PC-v1.1.0.zip',
  'project-picori': 'tmc-multi-windows-x86_64-v0.9.6.tar.gz', // não o arm64
  'dragons-crown-pro-pc': 'DragonsCrownProPC-v0.7.1-windows-x64.zip', // não o .sha256
  'driveclub-recomp': 'driveclub-recomp-0.3.1-win64.zip',
  'infamous-second-son-pc': 'infamous-windows-x86_64.zip', // não o tar.gz de Linux (que a Loja agora abre)
  'sotc-pc': 'SotC-PC.zip',
  'the-last-guardian-pc': 'tlg-windows-x86_64.zip',
  'shaolin-monks-recomp': 'ShaolinMonksRecomp-0.2.0-Windows-x64.zip',
  openmw: 'OpenMW-0.51.0-Windows-x64.exe', // o instalador do projeto
  'atomic-bomberman-modern': 'atomic-bomberman-modern-windows-x64.zip', // não o servidor dedicado
  'urbz-recomp': 'Urbz.zip',
  'tony-was-a-pro-skater': 'thps-windows-x64-1.4.0.zip', // não o x86
  cybermage: 'cybermage-windows-x64.zip', // não o .sha256
  urbanrecomp: 'UrbanRecomp-enhanced-v1.0.4-windows-x64-single.exe',
  'svr2011-pc': 'SvR2011-PC-v2.1.5.zip', // não o pacote de mods
  'power-dozer': 'power-dozer-v0.84-windows-x86_64.zip',
  'snowboard-kids-recomp': 'SnowboardKidsRecompiled-Windows.zip',
  aerofoil: 'Aerofoil-1.1.2-win64.zip', // não o .msi, as ferramentas nem os símbolos
  heretic2r: 'Heretic2R_R6.zip',
};

function port(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exemplo',
    name: 'Exemplo',
    original: { title: 'Jogo', platform: 'n64' },
    developer: 'Equipe',
    summary: 'Resumo',
    description: '',
    source: { type: 'github', repo: 'dono/repo' },
    assets: { windows: 'Windows\\.zip$' },
    requires: { kind: 'rom', label: 'ROM do jogo' },
    ...overrides,
  };
}

function makeCache(): ApiCache {
  return new ApiCache(new CacheRepository(openDatabase(':memory:')));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function rawRelease(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `Versão ${tag}`,
    published_at: '2026-10-18T21:06:27Z',
    prerelease: false,
    draft: false,
    body: 'Notas',
    html_url: `https://github.com/dono/repo/releases/tag/${tag}`,
    assets: [
      { name: 'App-Linux.zip', size: 10, browser_download_url: 'https://github.com/x/linux.zip', digest: 'sha256:aa' },
      { name: 'App-Windows.zip', size: 2048, browser_download_url: 'https://github.com/x/win.zip', digest: 'sha256:bb' },
    ],
    ...extra,
  };
}

describe('catálogo embutido', () => {
  it('é válido por inteiro e tem os ports esperados', () => {
    const { ports, skipped } = parseCatalog(SEED_CATALOG);
    expect(skipped).toEqual([]);
    expect(ports.map((p) => p.id).sort()).toEqual(Object.keys(EXPECTED_WINDOWS).sort());
  });

  it('a regex de cada port escolhe o arquivo certo de Windows nas versões reais', () => {
    for (const p of parseCatalog(SEED_CATALOG).ports) {
      const assets = REAL_ASSETS[p.id]!.map((name) => ({ name }));
      expect(pickAsset(assets, p.assets.windows)?.name, p.id).toBe(EXPECTED_WINDOWS[p.id]);
    }
  });

  it('nenhum projeto aparece duas vezes (mesmo repositório com outro id)', () => {
    const repos = parseCatalog(SEED_CATALOG).ports.map((p) => p.source.repo.toLowerCase());
    expect(repos.filter((r, i) => repos.indexOf(r) !== i)).toEqual([]);
  });
});

describe('parseCatalog', () => {
  it('ignora só o item inválido e mantém os outros', () => {
    const { ports, skipped } = parseCatalog({
      schemaVersion: 1,
      ports: [port(), port({ id: 'sem-repo', source: { type: 'github', repo: 'https://evil.example/x' } }), port({ id: 'b', original: { title: 'X', platform: 'atari' } })],
    });
    expect(ports.map((p) => p.id)).toEqual(['exemplo']);
    expect(skipped).toHaveLength(2);
  });

  it('executável aceita símbolos (™, acentos), mas nunca sair da pasta', () => {
    const ok = parseCatalog({ schemaVersion: 1, ports: [port({ executable: 'Crash™ Team Racing Nitro-Fueled.exe' })] });
    expect(ok.ports[0]?.executable).toBe('Crash™ Team Racing Nitro-Fueled.exe');
    for (const evil of ['../fora.exe', 'C:\\Windows\\x.exe', '\\x.exe', 'a<b.exe']) {
      expect(parseCatalog({ schemaVersion: 1, ports: [port({ executable: evil })] }).ports, evil).toHaveLength(0);
    }
  });

  it('rejeita regex inválida, id repetido e homepage sem https', () => {
    const { ports, skipped } = parseCatalog({
      schemaVersion: 1,
      ports: [port(), port(), port({ id: 'regex', assets: { windows: '([' } }), port({ id: 'http', homepage: 'http://site.com' })],
    });
    expect(ports).toHaveLength(1);
    expect(skipped.join('\n')).toMatch(/id repetido/);
    expect(skipped.join('\n')).toMatch(/regex inválida/);
    expect(skipped.join('\n')).toMatch(/apenas https/);
  });

  it('recusa catálogo de formato mais novo ou que não é catálogo', () => {
    expect(() => parseCatalog({ schemaVersion: CATALOG_SCHEMA_VERSION + 1, ports: [] })).toThrow(/atualize/);
    expect(() => parseCatalog({ itens: [] })).toThrow();
  });
});

describe('GitHubClient', () => {
  it('mapeia versões, ignora rascunhos e extrai o SHA-256', async () => {
    const urls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      urls.push(url);
      return json([rawRelease('v2', { prerelease: true }), rawRelease('v1'), rawRelease('rascunho', { draft: true })]);
    };
    const releases = await new GitHubClient(makeCache(), () => null, fetchFn).listReleases('dono/repo', 'Windows\\.zip$');
    expect(urls[0]).toBe('https://api.github.com/repos/dono/repo/releases?per_page=10');
    expect(releases.map((r) => r.tag)).toEqual(['v2', 'v1']);
    expect(releases[0]!.prerelease).toBe(true);
    expect(releases[1]!.windowsAsset).toEqual({
      name: 'App-Windows.zip',
      size: 2048,
      downloadUrl: 'https://github.com/x/win.zip',
      sha256: 'bb',
    });
  });

  it('usa o cache: a segunda consulta não chama o GitHub', async () => {
    let calls = 0;
    const gh = new GitHubClient(makeCache(), () => null, async () => {
      calls++;
      return json([rawRelease('v1')]);
    });
    await gh.listReleases('dono/repo', 'Windows');
    await gh.listReleases('Dono/Repo', 'Windows');
    expect(calls).toBe(1);
  });

  it('revalida com ETag: 304 reaproveita o cache sem baixar a lista de novo', async () => {
    const sent: (string | undefined)[] = [];
    let first = true;
    const gh = new GitHubClient(makeCache(), () => null, async (_url, init) => {
      sent.push(init.headers['If-None-Match']);
      if (first) {
        first = false;
        return json([rawRelease('v1')], 200, { etag: 'W/"abc"' });
      }
      return new Response(null, { status: 304 });
    });
    await gh.listReleases('dono/repo', 'Windows');
    const again = await gh.listReleases('dono/repo', 'Windows', true); // força a revalidação
    expect(sent).toEqual([undefined, 'W/"abc"']);
    expect(again.map((r) => r.tag)).toEqual(['v1']);
  });

  it('limite de consultas vira RATE_LIMITED com a hora de liberar', async () => {
    const gh = new GitHubClient(makeCache(), () => null, async () =>
      json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792760897' }),
    );
    await expect(gh.listReleases('dono/repo', 'Windows')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/60 por hora/) });
  });

  it('404 e falha de rede viram erros claros', async () => {
    await expect(new GitHubClient(makeCache(), () => null, async () => json({}, 404)).listReleases('dono/repo', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const offline = new GitHubClient(makeCache(), () => null, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offline.listReleases('dono/repo', 'x')).rejects.toMatchObject({ code: 'STORE_NETWORK' });
  });

  it('corta notas enormes', async () => {
    const gh = new GitHubClient(makeCache(), () => null, async () => json([rawRelease('v1', { body: 'x'.repeat(10_000) })]));
    const [r] = await gh.listReleases('dono/repo', 'Windows');
    expect(r!.notes.length).toBeLessThanOrEqual(6001);
  });
});

describe('GitHubClient com conta vinculada', () => {
  const TOKEN = `github_pat_${'A'.repeat(30)}`;

  it('o formato do token aceita clássico e fine-grained e recusa lixo', () => {
    expect(GITHUB_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    expect(GITHUB_TOKEN_PATTERN.test(`ghp_${'a1'.repeat(18)}`)).toBe(true);
    expect(GITHUB_TOKEN_PATTERN.test('minha senha')).toBe(false);
    expect(GITHUB_TOKEN_PATTERN.test(`github_pat_${'A'.repeat(30)} extra`)).toBe(false);
  });

  it('envia o token só quando há conta', async () => {
    const auth: (string | undefined)[] = [];
    let token: string | null = null;
    const gh = new GitHubClient(makeCache(), () => token, async (_url, init) => {
      auth.push(init.headers.Authorization);
      return json([rawRelease('v1')]);
    });
    await gh.listReleases('a/sem-conta', 'Windows');
    token = TOKEN;
    await gh.listReleases('a/com-conta', 'Windows');
    expect(auth).toEqual([undefined, `Bearer ${TOKEN}`]);
  });

  it('token revogado não derruba a Loja: refaz a consulta sem conta', async () => {
    const auth: (string | undefined)[] = [];
    const gh = new GitHubClient(makeCache(), () => TOKEN, async (_url, init) => {
      auth.push(init.headers.Authorization);
      return init.headers.Authorization ? json({ message: 'Bad credentials' }, 401) : json([rawRelease('v1')]);
    });
    expect((await gh.listReleases('dono/repo', 'Windows')).map((r) => r.tag)).toEqual(['v1']);
    expect(auth).toEqual([`Bearer ${TOKEN}`, undefined]);
  });

  it('verifyToken devolve o usuário e recusa token inválido sem tentar sem conta', async () => {
    const ok = new GitHubClient(makeCache(), () => null, async (url, init) => {
      expect(url).toBe('https://api.github.com/user');
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      return json({ login: 'jogador123' });
    });
    expect(await ok.verifyToken(TOKEN)).toBe('jogador123');

    let calls = 0;
    const bad = new GitHubClient(makeCache(), () => null, async () => {
      calls++;
      return json({ message: 'Bad credentials' }, 401);
    });
    await expect(bad.verifyToken(TOKEN)).rejects.toMatchObject({ code: 'GITHUB_AUTH' });
    expect(calls).toBe(1);
  });

  it('status traz o limite; sem internet devolve rate null', async () => {
    const gh = new GitHubClient(makeCache(), () => TOKEN, async () => json({ rate: { limit: 5000, remaining: 4990, reset: 1792760897 } }));
    expect(await gh.status('jogador123')).toEqual({
      login: 'jogador123',
      rate: { limit: 5000, remaining: 4990, resetAt: new Date(1792760897 * 1000).toISOString() },
    });
    const offline = new GitHubClient(makeCache(), () => null, async () => {
      throw new TypeError('fetch failed');
    });
    expect(await offline.status(null)).toEqual({ login: null, rate: null });
  });

  it('limite estourado com conta não sugere vincular conta', async () => {
    const gh = new GitHubClient(makeCache(), () => TOKEN, async () =>
      json({}, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1792760897' }),
    );
    await expect(gh.listReleases('dono/repo', 'x')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: expect.stringMatching(/da sua conta/) });
  });
});

describe('StoreCatalogService', () => {
  const noReleases = new GitHubClient(makeCache(), () => null, async () => json([]));

  it('sem URL remota usa o catálogo embutido', async () => {
    const store = new StoreCatalogService({ cache: makeCache(), github: noReleases, remoteUrl: () => null });
    const catalog = await store.catalog();
    expect(catalog.source).toBe('embedded');
    expect(catalog.ports.length).toBeGreaterThan(5);
  });

  it('usa o remoto válido e volta ao embutido se ele falhar', async () => {
    const remote = new StoreCatalogService({
      cache: makeCache(),
      github: noReleases,
      remoteUrl: () => 'https://exemplo.com/catalog.json',
      fetchFn: async () => json({ schemaVersion: 1, ports: [port({ id: 'remoto' })] }),
    });
    expect(await remote.catalog()).toMatchObject({ source: 'remote', ports: [{ id: 'remoto' }] });

    const broken = new StoreCatalogService({
      cache: makeCache(),
      github: noReleases,
      remoteUrl: () => 'https://exemplo.com/catalog.json',
      fetchFn: async () => json({ schemaVersion: 1, ports: [{ lixo: true }] }),
    });
    expect((await broken.catalog()).source).toBe('embedded');
  });

  it('busca versões pelo repositório do catálogo e recusa port desconhecido', async () => {
    const urls: string[] = [];
    const releases = new GitHubClient(makeCache(), () => null, async (url) => {
      urls.push(url);
      return json([rawRelease('v1')]);
    });
    const store = new StoreCatalogService({ cache: makeCache(), github: releases, remoteUrl: () => null });
    await store.releases('shipwright');
    expect(urls[0]).toContain('/repos/HarbourMasters/Shipwright/releases');
    await expect(store.releases('nao-existe')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
