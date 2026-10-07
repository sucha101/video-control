export class QueueClient{
 constructor({cloudUrl,secrets,workerId,fetchImpl=fetch}){this.base=cloudUrl;this.token=secrets?.runnerToken;this.workerId=workerId;this.fetch=fetchImpl;if(!this.base||!this.token)throw new Error('Thiếu Cloud URL hoặc runnerToken');}
 async request(route,body,signal){const response=await this.fetch(new URL(route,this.base),{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw new Error(`Cloud ${response.status}: ${result.error??'request failed'}`);return result;}
 async claim(){return (await this.request('/api/claim',{workerId:this.workerId})).job;}
 enqueue(type,payload,dedupeKey,sourceJobId){return this.request('/api/jobs',{type,payload,dedupeKey,...(sourceJobId?{sourceJobId}:{})});}
 heartbeat(job,summary){return this.request(`/api/jobs/${job.id}/heartbeat`,{workerId:this.workerId,leaseToken:job.leaseToken,...(summary?{summary}:{})});}
 complete(job,result){return this.request(`/api/jobs/${job.id}/complete`,{workerId:this.workerId,leaseToken:job.leaseToken,result});}
 fail(job,error,needsReview){return this.request(`/api/jobs/${job.id}/fail`,{workerId:this.workerId,leaseToken:job.leaseToken,error,needsReview});}
}
