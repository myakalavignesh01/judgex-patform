export function requestError(data:unknown,status:number){
 const d=(data&&typeof data==='object'?data:{}) as Record<string,unknown>;
 const code=String(d.error_code||d.code||'');
 if(code==='email_not_confirmed')return 'Verify your email before signing in. Open the confirmation link in your email, then return here.';
 if(code==='invalid_credentials')return 'The email or password is incorrect. Check your details or use Forgot password.';
 if(code==='over_email_send_rate_limit'||code==='over_request_rate_limit'||status===429)return 'Too many requests. Wait a few minutes before trying again.';
 for(const key of ['message','error_description','msg','error'])if(typeof d[key]==='string'&&String(d[key]).trim())return String(d[key]);
 return 'Request failed ('+status+'). Please try again.';
}
