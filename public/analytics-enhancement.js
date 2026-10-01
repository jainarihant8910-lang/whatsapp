// DeliveryOS Sales & Profit dashboard enhancements.
(function(){
  function setRange(days){
    const to=new Date(), from=new Date(to);
    from.setDate(to.getDate()-days+1);
    const iso=d=>d.toISOString().slice(0,10);
    analyticsFilters.from=iso(from); analyticsFilters.to=iso(to);
    analyticsPage();
  }
  window.setAnalyticsRange=setRange;

  window.exportAnalyticsCsv=async function(){
    try{
      const from=$('anFrom')?.value||analyticsFilters.from;
      const to=$('anTo')?.value||analyticsFilters.to;
      const product=$('anProduct')?.value||analyticsFilters.product;
      const customer=$('anCustomer')?.value||analyticsFilters.customer;
      const source=$('anSource')?.value||analyticsFilters.source;
      const q=new URLSearchParams({from,to,product_id:product,customer,source});
      const d=await api('/api/analytics/sales?'+q.toString());
      const rows=[['Product','Units','Sales','Cost','Profit','Margin %']];
      (d.products||[]).forEach(x=>rows.push([x.name,x.units,x.sales,x.cogs,x.profit,x.margin]));
      const escCsv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
      const csv=rows.map(r=>r.map(escCsv).join(',')).join('\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
      a.download='deliveryos-sales-profit-'+from+'-to-'+to+'.csv'; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Sales & profit CSV exported');
    }catch(e){toast(e.message,true)}
  };

  const originalAnalyticsPage=window.analyticsPage;
  window.analyticsPage=async function(){
    await originalAnalyticsPage();
    const filters=document.querySelector('.analytics-filters');
    if(!filters||document.getElementById('analyticsPresets'))return;
    const presets=document.createElement('div');
    presets.id='analyticsPresets'; presets.className='analytics-presets';
    presets.innerHTML='<span>Quick range:</span>'+
      '<button type="button" onclick="setAnalyticsRange(1)">Today</button>'+
      '<button type="button" onclick="setAnalyticsRange(7)">7 days</button>'+
      '<button type="button" onclick="setAnalyticsRange(30)">30 days</button>'+
      '<button type="button" onclick="setAnalyticsRange(90)">90 days</button>'+
      '<button type="button" onclick="exportAnalyticsCsv()">Export CSV</button>';
    filters.parentNode.insertBefore(presets,filters.nextSibling);
  };

  const originalDashboard=window.dashboard;
  window.dashboard=async function(){
    await originalDashboard();
    try{
      const today=new Date().toISOString().slice(0,10);
      const d=await api('/api/analytics/sales?from='+today+'&to='+today+'&source=ALL');
      const s=d.summary||{};
      const box=document.createElement('section');
      box.className='panel dashboard-profit-card';
      box.innerHTML='<div class="bar"><div><h3>Today’s sales & profit</h3><p class="muted">Delivered orders, after recorded returns.</p></div><button onclick="go(\'analytics\')">Open analysis →</button></div>'+
        '<div class="grid stats analytics-mini-stats">'+
        card('Sales','₹'+n(s.sales),'Net sales')+
        card('Cost','₹'+n(s.cogs),'Cost of goods')+
        card('Profit','₹'+n(s.profit),n(s.margin)+'% margin')+
        card('Units',n(s.units),'Net units sold')+'</div>';
      $('page').appendChild(box);
    }catch(e){}
  };
})();