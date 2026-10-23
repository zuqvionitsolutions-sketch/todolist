const express=require('express'),mongoose=require('mongoose'),path=require('path'),crypto=require('crypto');
const {rateLimit}=require('express-rate-limit');
require('dotenv').config();
const app=express(),port=Number(process.env.PORT||3000),secret=process.env.AUTH_SECRET,uri=process.env.MONGODB_URI;
if(!secret||secret.length<32)throw Error('Set AUTH_SECRET in .env'); if(!uri)throw Error('Set MONGODB_URI in .env');
mongoose.set('strictQuery',true);
const User=mongoose.model('User',new mongoose.Schema({displayName:{type:String,required:true,minlength:2,maxlength:100},nameKey:{type:String,required:true,index:true},dobSalt:{type:String,required:true},dobHash:{type:String,required:true}},{timestamps:{createdAt:true,updatedAt:false}}));
const Todo=mongoose.model('Todo',new mongoose.Schema({ownerId:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},title:{type:String,required:true,trim:true,minlength:1,maxlength:500},description:{type:String,default:'',maxlength:5000},category:{type:String,default:'General',maxlength:100},priority:{type:String,enum:['Low','Medium','High'],default:'Medium'},dueDate:{type:String,default:'',match:/^$|^\d{4}-\d{2}-\d{2}$/},completed:{type:Boolean,default:false}},{timestamps:true}));
Todo.schema.index({ownerId:1,createdAt:1});
const COOKIE='todo_session',TTL=604800;
app.disable('x-powered-by');if(process.env.TRUST_PROXY)app.set('trust proxy',process.env.TRUST_PROXY);app.use(express.json({limit:'20kb'}));
const authLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many authentication attempts. Please try again later.'}});
app.use((req,res,next)=>{const o=req.get('Origin');if(o&&process.env.APP_ORIGIN&&o!==process.env.APP_ORIGIN)return res.status(403).json({error:'Cross-origin requests are not allowed.'});next();});
app.get('/',(_q,s)=>s.sendFile(path.join(__dirname,'Untitled-09.html')));app.use(express.static(__dirname));
function sign(x){return crypto.createHmac('sha256',secret).update(x).digest('base64url')}
function setSession(res,id){const p=id+'.'+(Math.floor(Date.now()/1000)+TTL),t=p+'.'+sign(p);res.setHeader('Set-Cookie',COOKIE+'='+encodeURIComponent(t)+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+TTL+(process.env.NODE_ENV==='production'?'; Secure':''))}
function clearSession(res){res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+(process.env.NODE_ENV==='production'?'; Secure':''))}
function sessionId(req){const c=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));let t='';try{t=c?decodeURIComponent(c.slice(COOKIE.length+1)):''}catch{}const p=t.split('.');if(p.length!==3||!mongoose.isValidObjectId(p[0]))return null;const payload=p[0]+'.'+p[1],a=Buffer.from(sign(payload)),b=Buffer.from(p[2]),e=Number(p[1]);return a.length===b.length&&crypto.timingSafeEqual(a,b)&&Number.isSafeInteger(e)&&e>Date.now()/1000?p[0]:null}
function auth(req,res,next){const id=sessionId(req);if(!id)return res.status(401).json({error:'Please log in to continue.'});req.userId=id;next()}
function validDob(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+'T00:00:00Z');return !isNaN(d)&&d.toISOString().slice(0,10)===x&&x<=new Date().toISOString().slice(0,10)}
function hashDob(x,s){return new Promise((r,j)=>crypto.scrypt(x,s,64,(e,k)=>e?j(e):r(k.toString('hex'))))}
function equalHex(x,y){const a=Buffer.from(x,'hex'),b=Buffer.from(y,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function name(x){return typeof x==='string'?x.trim().replace(/\s+/g,' '):''}
function out(d){const id=String(d._id);return{id,_id:id,title:d.title,description:d.description||'',text:d.title,category:d.category,priority:d.priority,dueDate:d.dueDate||'',completed:!!d.completed,createdAt:d.createdAt,updatedAt:d.updatedAt}}
function validDate(x){return x===''||(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x)}
function parse(b,partial){if(!b||typeof b!=='object'||Array.isArray(b))return{error:'Request body must be a JSON object.'};const v={},title=b.title===undefined?b.text:b.title;
if(!partial||title!==undefined){if(typeof title!=='string'||!title.trim()||title.trim().length>500)return{error:'Title must be 1 to 500 characters.'};v.title=title.trim()}
if(!partial||b.description!==undefined){if(b.description!==undefined&&(typeof b.description!=='string'||b.description.length>5000))return{error:'Description must be at most 5000 characters.'};v.description=b.description||''}
for(const k of ['category','priority','dueDate','completed']){const x=b[k];if(x===undefined){if(!partial)v[k]=({category:'General',priority:'Medium',dueDate:'',completed:false})[k];continue}
if(k==='category'){if(typeof x!=='string'||x.trim().length>100)return{error:'Invalid category.'};v[k]=x.trim()||'General'}
else if(k==='priority'){if(!['Low','Medium','High'].includes(x))return{error:'Invalid priority.'};v[k]=x}
else if(k==='dueDate'){if(!validDate(x))return{error:'Due date must be YYYY-MM-DD or empty.'};v[k]=x}
else{if(typeof x!=='boolean')return{error:'Completed must be true or false.'};v[k]=x}}
return{value:v}}
app.get('/api/auth/me',async(req,res,next)=>{try{const id=sessionId(req);if(!id)return res.json({user:null});const u=await User.findById(id).select('displayName').lean();if(!u){clearSession(res);return res.json({user:null})}res.json({user:{id:String(u._id),name:u.displayName}})}catch(e){next(e)}});
app.post('/api/auth/signup',authLimiter,async(req,res,next)=>{try{const n=name(req.body?.name),dob=req.body?.dateOfBirth;if(n.length<2||n.length>100)return res.status(400).json({error:'Name must be 2 to 100 characters.'});if(!validDob(dob))return res.status(400).json({error:'Enter a valid date of birth.'});const key=n.toLocaleLowerCase('en-US');for(const u of await User.find({nameKey:key}).select('dobSalt dobHash').lean())if(equalHex(await hashDob(dob,u.dobSalt),u.dobHash))return res.status(409).json({error:'This account already exists. Please log in.'});const salt=crypto.randomBytes(16).toString('hex'),u=await User.create({displayName:n,nameKey:key,dobSalt:salt,dobHash:await hashDob(dob,salt)});setSession(res,String(u._id));res.status(201).json({user:{id:String(u._id),name:n}})}catch(e){next(e)}});
app.post('/api/auth/login',authLimiter,async(req,res,next)=>{try{const n=name(req.body?.name),dob=req.body?.dateOfBirth;if(!n||!validDob(dob))return res.status(400).json({error:'Enter your name and a valid date of birth.'});for(const u of await User.find({nameKey:n.toLocaleLowerCase('en-US')}).select('displayName dobSalt dobHash').lean())if(equalHex(await hashDob(dob,u.dobSalt),u.dobHash)){setSession(res,String(u._id));return res.json({user:{id:String(u._id),name:u.displayName}})}res.status(401).json({error:'Name or date of birth did not match.'})}catch(e){next(e)}});
app.post('/api/auth/logout',(_q,s)=>{clearSession(s);s.status(204).end()});
async function list(q,s,n){try{s.json((await Todo.find({ownerId:q.userId}).sort({createdAt:1,_id:1}).lean()).map(out))}catch(e){n(e)}}
async function create(q,s,n){try{const p=parse(q.body,false);if(p.error)return s.status(400).json({error:p.error});s.status(201).json(out(await Todo.create({...p.value,ownerId:q.userId})))}catch(e){n(e)}}
function idOk(x){return mongoose.isValidObjectId(x)}
async function get(q,s,n){try{if(!idOk(q.params.id))return s.status(400).json({error:'Invalid task id.'});const d=await Todo.findOne({_id:q.params.id,ownerId:q.userId}).lean();if(!d)return s.status(404).json({error:'Task not found.'});s.json(out(d))}catch(e){n(e)}}
async function patch(q,s,n){try{if(!idOk(q.params.id))return s.status(400).json({error:'Invalid task id.'});const p=parse(q.body,true);if(p.error)return s.status(400).json({error:p.error});if(!Object.keys(p.value).length)return s.status(400).json({error:'Provide a field to update.'});const d=await Todo.findOneAndUpdate({_id:q.params.id,ownerId:q.userId},{$set:p.value},{returnDocument:'after',runValidators:true}).lean();if(!d)return s.status(404).json({error:'Task not found.'});s.json(out(d))}catch(e){n(e)}}
async function remove(q,s,n){try{if(!idOk(q.params.id))return s.status(400).json({error:'Invalid task id.'});const r=await Todo.deleteOne({_id:q.params.id,ownerId:q.userId});if(!r.deletedCount)return s.status(404).json({error:'Task not found.'});s.status(204).end()}catch(e){n(e)}}
app.get('/api/todos',auth,list);app.get('/api/todos/:id',auth,get);app.post('/api/todos',auth,create);app.patch('/api/todos/:id',auth,patch);app.delete('/api/todos/:id',auth,remove);
app.get('/api/tasks',auth,list);app.post('/api/tasks',auth,create);app.put('/api/tasks/:id',auth,patch);app.patch('/api/tasks/:id',auth,patch);app.delete('/api/tasks/:id',auth,remove);
app.use((e,_q,s,_n)=>{if(e instanceof SyntaxError&&e.status===400)return s.status(400).json({error:'Invalid JSON request body.'});console.error('Request failed:',e.name||'Error');s.status(500).json({error:'Server error. Please try again later.'})});
async function start(){try{await mongoose.connect(uri,{serverSelectionTimeoutMS:Number(process.env.MONGODB_TIMEOUT_MS||10000)});app.listen(port,()=>console.log('To-do app listening on port '+port+'; MongoDB connected.'))}catch{console.error('MongoDB connection failed. Check MONGODB_URI, database-user permissions, and Atlas Network Access.');process.exitCode=1}}start();
