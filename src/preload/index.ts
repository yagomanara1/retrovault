import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type Bridge } from '@shared/ipc';

// Superfície mínima exposta ao renderer: só canais da whitelist, sem acesso ao ipcRenderer cru.
const bridge: Bridge = {
  invoke: (channel, input) => {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Canal IPC não permitido: ${channel}`));
    }
    return ipcRenderer.invoke(channel, input);
  },
  on: (event, listener) => {
    if (!EVENT_CHANNELS.has(event)) throw new Error(`Evento IPC não permitido: ${event}`);
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('bridge', bridge);
