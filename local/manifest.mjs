import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import path from 'node:path';
export async function atomicJSON(file,value){await mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await rename(temp,file);}
export async function readJSON(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function lock(file){await mkdir(path.dirname(file),{recursive:true});let handle;try{handle=await open(file,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));}catch(e){if(e.code==='EEXIST')throw new Error('Runner đang chạy hoặc khóa còn lại sau crash; chạy doctor và xác minh PID trước khi xóa khóa.');throw e;}return async()=>{await handle.close();await unlink(file);};}
