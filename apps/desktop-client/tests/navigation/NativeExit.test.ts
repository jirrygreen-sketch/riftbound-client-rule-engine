import { afterEach, describe, expect, it, vi } from 'vitest';
import { exitDesktopClient } from '../../src/navigation/native-exit';
afterEach(()=>vi.unstubAllGlobals());
describe('desktop exit adapter',()=>{
 it('uses the public native command when running inside Tauri',async()=>{
   const invoke=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('window',{__TAURI__:{core:{invoke}}});
   expect(await exitDesktopClient()).toBe(true);expect(invoke).toHaveBeenCalledExactlyOnceWith('exit_client');
 });
 it('does not pretend to close a browser preview',async()=>{
   vi.stubGlobal('window',{});expect(await exitDesktopClient()).toBe(false);
 });
 it('returns native failures to the app instead of claiming exit succeeded',async()=>{
   vi.stubGlobal('window',{__TAURI__:{core:{invoke:vi.fn().mockRejectedValue(new Error('native unavailable'))}}});
   await expect(exitDesktopClient()).rejects.toThrow('native unavailable');
 });
});
