import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as icons from 'lucide-vue-next'
import { renderToString } from '@vue/server-renderer'
import { adminPageState, createAdminPage } from '../src/services/adminPageController.js'
const auth = () => ({ provider:'supabase',user:{id:'admin'},profile:{uid:'admin',fullName:'Trusted Admin',email:'trusted@example.invalid',role:'admin',status:'approved'} })
const defer = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve} }
async function load(file, {state=auth(),client={},review=async()=>{},register=async()=>{},globals={},virtualHost=false}={}) {
  const context=createContext({AbortController,setTimeout,clearTimeout,URL,Blob,console,...globals}),cache=new Map()
  const synthetic=exports=>new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v)},{context})
  async function module(filename) {
    if(cache.has(filename))return cache.get(filename)
    const pending = (async () => {
    let source=await readFile(filename,'utf8')
    if(filename.endsWith('.vue')) { const {descriptor}=parse(source);const compiled=compileTemplate({source:descriptor.template.content,filename,id:'s7-test'});assert.deepEqual(compiled.errors,[]);source=descriptor.script.content+'\n'+compiled.code }
    const m=new SourceTextModule(source,{context})
    await m.link(async specifier=>{
      if(specifier.endsWith('.png'))return synthetic({default:'logo.png'})
      if(specifier==='vue')return synthetic(virtualHost ? {...vue,vModelText:{},vModelSelect:{}} : vue)
      if(specifier==='lucide-vue-next')return synthetic(icons)
      if(/\/auth(?:\.js)?$/.test(specifier))return synthetic({authState:state,registerStudent:register,logout:async()=>{}})
      if(/supabase\/supabase\.js$/.test(specifier))return synthetic({supabase:client})
      if(/\/users$/.test(specifier))return synthetic({reviewStudent:review,profileFromRow:r=>({uid:r.id,fullName:r.full_name,studentId:r.student_id,email:r.email,status:r.status,program:r.program,rosterEligible:r.roster_eligible===true,createdAt:r.created_at})})
      let target=path.resolve(path.dirname(filename),specifier);if(!path.extname(target))target+='.js';return module(target)
    });return m
    })()
    cache.set(filename,pending);return pending
  }
  const root=await module(path.resolve(file));await root.evaluate()
  for(const [filename,pending]of cache)if(filename.endsWith('.vue')){const m=await pending;m.namespace.default.render=m.namespace.render}
  return root.namespace
}
async function render(file,data={},props={},options={}) {
  const {default:component}=await load(file,options),old=component.data
  const app=vue.createSSRApp({...component,data(){return {...(old?old.call(this):{}),...data}}},props)
  app.component('RouterLink',{props:['to'],render(){return vue.h('a',{href:this.to},this.$slots.default?.())}})
  return renderToString(app)
}
function vm(component,values={}) { const instance={...component.data?.(),...values};for(const [name,method]of Object.entries(component.methods||{}))instance[name]=method.bind(instance);return instance }

test('U1.1 roster requires Student Name and shows correction state',async()=>{
  const html=await render('src/components/AuthorizedStudents.vue',{state:{...adminPageState(),rows:[{student_id:'LEGACY',expected_name:'Legacy Name',verification_ready:false,is_active:true,registration_state:'not_registered'}]}})
  assert.match(html,/Student Name/);assert.match(html,/Last Name, First Name Middle Name\/Suffix/)
  assert.match(html,/id="roster-name"[^>]*required/);assert.match(html,/Name correction required/);assert.match(html,/>Edit</)
  assert.doesNotMatch(html,/optional/)
})
test('U1.1 correction RPC forwards only immutable ID and new name',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:null,error:null}}}}}
  const {default:c}=await load('src/components/AuthorizedStudents.vue',{client})
  const instance=vm(c,{identity:'admin',$emit(){}});instance.editName({student_id:'ABC',expected_name:'Before'})
  instance.correctedName='After, Student';await instance.saveName()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['admin_update_authorized_student_name',{student_id:'ABC',expected_name:'After, Student'}]])
})
for(const eligible of [true,false])test(`U1.1 pending eligibility ${eligible} controls green/red and Approve only`,async()=>{
  const html=await render('src/components/PendingRegistrations.vue',{registrations:[{uid:'s',fullName:'Student',studentId:'ABC',rosterEligible:eligible}]})
  assert.match(html,eligible?/AUTHORIZED \/ ROSTER VERIFIED/:/NOT CURRENTLY ELIGIBLE/)
  const approve=html.match(/<button[^>]*>Approve<\/button>/)?.[0],reject=html.match(/<button[^>]*>Reject<\/button>/)?.[0]
  assert.ok(approve);assert.equal(/\sdisabled(?:[ =>])/.test(approve),eligible?false:true);assert.ok(reject);assert.equal(/\sdisabled(?:[ =>])/.test(reject),false)
})
test('U1.1 pending local handler refuses stale ineligible approval but permits rejection',async()=>{
  const calls=[],{default:c}=await load('src/components/PendingRegistrations.vue',{review:async(...args)=>calls.push(args),client:{rpc(){return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}})
  const instance=vm(c,{identity:'admin',registrations:[{uid:'s',rosterEligible:false}],decision:{uid:'s',status:'approved'},$emit(){}})
  await instance.confirmReview();assert.equal(calls.length,0);assert.match(instance.error,/not currently eligible/)
  instance.decision={uid:'s',status:'rejected'};await instance.confirmReview();assert.equal(calls[0][1],'rejected')
})
test('U1.1 signup renders required surname without roster lookup and preserves every value on failure',async()=>{
  let submits=0
  const options={register:async()=>{submits++;throw Error('The Student ID or last name could not be verified.')}}
  const html=await render('src/views/auth/SignupView.vue',{}, {},options)
  assert.match(html,/id="signup-lastName"[^>]*required/);assert.match(html,/Student ID and Last Name/)
  const {default:c}=await load('src/views/auth/SignupView.vue',options)
  const form={fullName:'Display Name',studentId:'ABC',lastName:'Entered Name',program:'BS Information Technology'}
  const instance=vm(c,{form});await instance.register()
  assert.equal(submits,1);assert.deepEqual(instance.form,form);assert.match(instance.error,/could not be verified/);assert.equal(instance.busy,false)
})

