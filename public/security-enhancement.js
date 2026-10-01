(function(){
async function loadSecurityPanel(){
 try{
  const [u,a,g,b]=await Promise.all([api('/api/security/users'),api('/api/security/audit'),api('/api/security/gst-schedules'),api('/api/security/backup-list')]);
  const users=u.users||[],logs=a.logs||[],schedules=g.schedules||[],backups=b.files||[];
  const p=document.createElement('section');p.className='panel';
  p.innerHTML='<div class="bar"><div><h3>DeliveryOS Control Center</h3><p class="muted">Backups, GST schedules, users and audit history.</p></div><button onclick="downloadDeliveryBackup()">Download backup</button></div>'+
  '<div class="grid two"><div><h4>Users & permissions</h4><div class="tablewrap"><table><thead><tr><th>User</th><th>Role</th></tr></thead><tbody>'+users.map(x=>'<tr><td>'+esc(x.username)+'</td><td>'+esc(x.role)+'</td></tr>').join('')+'</tbody></table></div><div class="formgrid"><input id="newSecUser" placeholder="Username"><input id="newSecPass" type="password" placeholder="Password (8+ chars)"><select id="newSecRole"><option>STAFF</option><option>MANAGER</option><option>ADMIN</option><option>VIEWER</option></select><button onclick="createSecurityUser()">Create user</button></div></div>'+
  '<div><h4>GST schedules</h4><div class="tablewrap"><table><thead><tr><th>HSN</th><th>Product</th><th>New rate</th><th>Effective</th><th>Status</th></tr></thead><tbody>'+(schedules.map(x=>'<tr><td>'+esc(x.hsn_code)+'</td><td>'+esc(x.product_name)+'</td><td>'+n(x.new_rate)+'%</td><td>'+esc(x.effective_from)+'</td><td>'+esc(x.status)+'</td></tr>').join('')||'<tr><td colspan="5" class="muted">No scheduled GST changes.</td></tr>')+'</tbody></table></div></div></div>'+
  '<h4>Recent audit activity</h4><div class="tablewrap"><table><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>'+(logs.slice(0,50).map(x=>'<tr><td>'+esc(x.created_at)+'</td><td>'+esc(x.username||'-')+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.entity)+'</td><td><small>'+esc(x.details||'')+'</small></td></tr>').join('')||'<tr><td colspan="5" class="muted">No audit activity yet.</td></tr>')+'</tbody></table></div>'+
  '<h4>Backups</h4><div class="tablewrap"><table><thead><tr><th>File</th><th>Created</th><th>Size</th></tr></thead><tbody>'+(backups.slice(0,20).map(x=>'<tr><td>'+esc(x.file)+'</td><td>'+esc(x.created_at)+'</td><td>'+Math.round(x.size/1024)+' KB</td></tr>').join('')||'<tr><td colspan="3" class="muted">No backups yet.</td></tr>')+'</tbody></table></div>';
  $('page').appendChild(p);
 }catch(e){toast(e.message,true)}
}
window.downloadDeliveryBackup=()=>{window.location.href='/api/security/backup'};
window.createSecurityUser=async()=>{try{await api('/api/security/users',{method:'POST',body:{username:$('newSecUser').value.trim(),password:$('newSecPass').value,role:$('newSecRole').value}});toast('User created');settingsPage()}catch(e){toast(e.message,true)}};
const oldSettings=window.settingsPage;
window.settingsPage=async function(){await oldSettings();await loadSecurityPanel()};
window.gstTemplate=()=>{const text=['GST_UPDATE','','# DeliveryOS GST update file','# Keep exactly ONE row per HSN.','# PRODUCT must match the product in DeliveryOS.','# OLD_RATE must match the current GST rate.','# NEW_RATE is the rate to apply from EFFECTIVE_FROM.','','EFFECTIVE_FROM: 2027-04-01','','HSN|PRODUCT|OLD_RATE|NEW_RATE','4802|A4 Sheet|18|12','8443|Printer|18|18','','END'].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));a.download='deliveryos-gst-update-template.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
})();