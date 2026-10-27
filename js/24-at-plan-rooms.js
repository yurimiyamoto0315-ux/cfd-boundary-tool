/* Positioned, already anonymized plan labels only. No PDF/file/network access. */
(function(root){
  'use strict';
  const normalize=value=>String(value??'').normalize('NFKC').replace(/[−‐‑‒–—―]/g,'-').trim();
  const roomAliases=new Map([
    ['ＬＤＫ','LDK'],['LDK','LDK'],['L・D・K','LDK'],['DK','DK'],['LD','LD'],
    ['リビング','リビング'],['居間','居間'],['食堂','食堂'],['ダイニング','ダイニング'],['キッチン','キッチン'],['台所','台所'],
    ['洋室','洋室'],['和室','和室'],['寝室','寝室'],['主寝室','主寝室'],['子供室','子供室'],['子ども室','子ども室'],['子供部屋','子供部屋'],['子ども部屋','子ども部屋'],['子供コーナー','子供コーナー'],['子どもコーナー','子どもコーナー'],
    ['書斎','書斎'],['書庫','書庫'],['家事室','家事室'],['家事コーナー','家事コーナー'],['予備室','予備室'],['多目的室','多目的室'],['客室','客室'],['ワークスペース','ワークスペース'],['ファミリールーム','ファミリールーム'],['サンルーム','サンルーム'],
    ['玄関','玄関'],['玄関ホール','玄関ホール'],['ホール','ホール'],['階段','階段'],['階段室','階段室'],['廊下','廊下'],['ローカ','廊下'],['土間','土間'],
    ['物入','物入'],['物入れ','物入'],['収納','収納'],['収納室','収納室'],['押入','押入'],['押入れ','押入'],['納戸','納戸'],['パントリー','パントリー'],['食品庫','食品庫'],
    ['クローゼット','クローゼット'],['クロゼット','クローゼット'],['ウォークインクローゼット','WIC'],['ウォークインクロゼット','WIC'],['WIC','WIC'],
    ['ウォークスルークローゼット','WTC'],['ウォークスルークロゼット','WTC'],['WTC','WTC'],['ファミリークローゼット','FCL'],['FCL','FCL'],
    ['シューズクローク','SIC'],['シューズインクローク','SIC'],['シューズインクローゼット','SIC'],['SIC','SIC'],['土間収納','土間収納'],
    ['UB','UB'],['浴室','浴室'],['ユニットバス','UB'],
    ['洗面コーナー','洗面コーナー'],['洗面室','洗面室'],['洗面所','洗面所'],['洗面','洗面'],['洗面化粧室','洗面化粧室'],
    ['脱衣室','脱衣室'],['脱衣所','脱衣所'],['脱衣','脱衣'],['脱衣コーナー','脱衣コーナー'],
    ['洗面脱衣室','洗面脱衣室'],['洗面脱衣','洗面脱衣'],['洗面脱衣所','洗面脱衣所'],['洗面脱衣コーナー','洗面脱衣コーナー'],
    ['脱衣洗面室','洗面脱衣室'],['脱衣洗面','洗面脱衣'],['脱衣洗面所','洗面脱衣所'],['パウダールーム','パウダールーム'],
    ['洗面/脱衣室','洗面脱衣室'],['洗面/脱衣','洗面脱衣'],['洗面/脱衣所','洗面脱衣所'],['脱衣/洗面室','洗面脱衣室'],
    ['トイレ','トイレ'],['便所','トイレ'],['WC','トイレ'],['ランドリー','ランドリー'],['ランドリールーム','ランドリー'],['洗濯室','洗濯室'],
    ['機械室','機械室'],['ボイラー室','ボイラー室'],['PS','PS'],['MB','MB'],['小屋裏','小屋裏'],['屋根裏','小屋裏'],['床下','床下'],
    ['バルコニー','バルコニー'],['ベランダ','ベランダ'],['吹抜','吹抜'],['吹抜け','吹抜'],['吹き抜け','吹抜'],['吹きぬけ','吹抜'],['テラス','テラス'],['ポーチ','ポーチ'],['玄関ポーチ','玄関ポーチ'],['車庫','車庫']
  ].map(([key,value])=>[normalize(key).replace(/[\s.・]/g,'').toUpperCase(),value]));
  const areaPattern=/((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?|[0-9]+,[0-9]{1,2})\s*(?:m[²2]|平米)/i;
  const dimensionPattern=/([0-9]+(?:\.[0-9]+)?)\s*[×xX*]\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|m)?/;
  function areaIn(text){
    const match=normalize(text).match(areaPattern);if(!match)return null;
    const token=match[1],value=Number(token.includes('.')||/,\d{3}(?:,|$)/.test(token)?token.replace(/,/g,''):token.replace(',','.'));return value>0&&Number.isFinite(value)?value:null;
  }
  function dimensionsIn(text){
    const match=normalize(text).match(dimensionPattern);if(!match)return null;
    const scale=match[3]==='mm'?.001:1,dx=Number(match[1])*scale,dy=Number(match[2])*scale;
    return dx>0&&dy>0&&dx<100&&dy<100?{dx,dy}:null;
  }
  function roomName(value){
    let text=normalize(value).replace(areaPattern,'').replace(dimensionPattern,'').replace(/\(\s*\)|\[\s*\]/g,'');
    text=text.replace(/^[1-9][0-9]?(?:階|F)\s*[:・-]?\s*/i,'').replace(/\(?\s*[0-9]+(?:\.[0-9]+)?\s*(?:帖|畳|J)\s*\)?/gi,'').replace(/\([0-9]+\.[0-9]+\)$/,'');
    text=text.trim().replace(/\(([0-9]{1,2}|[A-Za-z])\)$/,'$1').replace(/^\s*[\[(]\s*|\s*[\])]\s*$/g,'').replace(/[\s.・]/g,'').toUpperCase();
    if(roomAliases.has(text))return roomAliases.get(text);
    const numbered=text.match(/^(.*?)([0-9]{1,2}|[A-Z])$/);
    return numbered&&roomAliases.has(numbered[1])?roomAliases.get(numbered[1])+(/^\d+$/.test(numbered[2])?String(Number(numbered[2])):numbered[2]):null;
  }
  function floorIn(value){
    const text=normalize(value).replace(/\s/g,'').toUpperCase();
    let match=text.match(/^(?:地下([1-9][0-9]?)階|B([1-9][0-9]?)(?:F|階)?)(?=居室区画図|平面|FLOORPLAN|PLAN|$)/);
    if(match)return 'B'+(match[1]||match[2]);
    match=text.match(/^([1-9][0-9]?)(?:階|F)(?=居室区画図|平面|FLOORPLAN|PLAN|$)/);
    if(match)return String(Number(match[1]));
    if(/^(?:R|RF|屋上)(?:平面図|PLAN)?$/.test(text))return 'R';
    return '';
  }
  function safeFloor(value){const text=normalize(value);return /^[1-9][0-9]?$/.test(text)?String(Number(text)):floorIn(text);}
  const hasPlanHeading=value=>/居室区画図|平面図|各階平面|FLOORPLAN/.test(normalize(value).replace(/\s/g,'').toUpperCase());
  function positioned(page){
    return (page.items||[]).map((item,id)=>{
      const text=normalize(item.text??item.str),height=Math.abs(Number(item.height)||0)||8;
      const estimated=[...text].reduce((n,ch)=>n+(/[\u0020-\u007e]/.test(ch)?.55:1)*height,0);
      return {id,text,x:Number(item.x??item.transform?.[4]),y:Number(item.y??item.transform?.[5]),width:Math.abs(Number(item.width)||0)||estimated,height};
    }).filter(item=>item.text&&Number.isFinite(item.x)&&Number.isFinite(item.y));
  }
  function areaCandidates(items){
    const units=items.filter(i=>/^(?:m2|平米)$/i.test(i.text)).map(i=>({...i,ids:[i.id]}));
    items.filter(i=>/^m$/i.test(i.text)).forEach(m=>{
      const exponent=items.filter(i=>i.text==='2'&&i.x>=m.x+m.width-.5&&i.x-m.x-m.width<=Math.max(4,m.height*.6)&&Math.abs(i.y-m.y)<=m.height*.8).sort((a,b)=>a.x-b.x)[0];
      if(exponent)units.push({...m,text:'m2',width:exponent.x+exponent.width-m.x,ids:[m.id,exponent.id]});
    });
    const paired=[],pairedNumbers=new Set();
    items.filter(i=>/^\d+(?:[.,]\d+)?$/.test(i.text)).forEach(numeric=>{
      const candidates=units.filter(unit=>Math.abs(unit.y-numeric.y)<=Math.max(2,numeric.height*.3)&&unit.x>=numeric.x+numeric.width-.5&&unit.x-numeric.x-numeric.width<=Math.max(6,numeric.height*.9)).sort((a,b)=>(a.x-numeric.x-numeric.width)-(b.x-numeric.x-numeric.width));
      if(!candidates.length)return;
      const unit=candidates[0],value=areaIn(numeric.text+' '+unit.text);if(value===null)return;
      paired.push({...numeric,width:unit.x+unit.width-numeric.x,value,ids:[numeric.id,...unit.ids],explicit:true});pairedNumbers.add(numeric.id);
    });
    const originals=items.filter(i=>!pairedNumbers.has(i.id)).map(item=>{
      const explicit=areaIn(item.text);
      const linearUnit=items.some(unit=>/^(?:m|mm)$/i.test(unit.text)&&Math.abs(unit.y-item.y)<=Math.max(2,item.height*.3)&&unit.x>=item.x+item.width-.5&&unit.x-item.x-item.width<=Math.max(6,item.height*.9));
      const bare=!linearUnit&&/^\d+\.\d{1,2}$/.test(item.text)?Number(item.text):null;
      return {...item,value:explicit??bare,ids:[item.id],explicit:explicit!==null};
    }).filter(a=>a.value>0);
    return paired.concat(originals);
  }
  function fragmentText(sequence){
    return sequence.map((item,index)=>{
      const prior=sequence[index-1];
      const separate=prior&&/\d$/.test(prior.text)&&/^\d/.test(item.text);
      return (separate?' ':'')+item.text;
    }).join('');
  }
  function numericTableCell(text){
    const value=normalize(text).replace(/(?:m2|平米)$/i,'').trim();
    return /\d/.test(value)&&/^[0-9.,()+\-*×xX÷/=:\[\]\s]+$/.test(value);
  }
  function washroomCandidateAllowed(candidate,items){
    if(!/^(?:洗面|脱衣|パウダールーム)/.test(candidate.name))return true;
    // A decimal area in its own item is not a room-number suffix.
    if(candidate.area===null&&candidate.ids.some(id=>/^\d+\.\d+$/.test(items.find(i=>i.id===id)?.text||'')))return false;
    const included=new Set(candidate.ids);let left=candidate.x,right=candidate.x+candidate.width,changed=true;
    while(changed){
      changed=false;
      items.forEach(item=>{
        if(included.has(item.id)||Math.abs(item.y-candidate.y)>Math.max(2,Math.max(item.height,candidate.height)*.3))return;
        const gap=Math.max(0,left-item.x-item.width,item.x-right);
        if(gap>Math.max(4,Math.max(item.height,candidate.height)*.9))return;
        included.add(item.id);left=Math.min(left,item.x);right=Math.max(right,item.x+item.width);changed=true;
      });
    }
    const allowed=text=>roomName(text)!==null||areaIn(text)!==null||dimensionsIn(text)!==null||!!floorIn(text)||/^(?:\d+(?:[.,]\d+)?|m2|平米|m|mm|cm|[ABC]|[()+\-*×xX÷/=:,]+)$/i.test(text);
    // Require complete known context for a nearby run. In particular, the
    // generic prefix 洗面 cannot rescue the equipment label 洗面 化粧台.
    return items.every(item=>!included.has(item.id)||candidate.ids.includes(item.id)||allowed(item.text));
  }
  function labelCandidates(items,page){
    const candidates=[];
    items.forEach(start=>{
      ['horizontal','vertical'].forEach(axis=>{
        const sequence=[start];let current=start;
        for(let count=0;count<10;count++){
          const text=fragmentText(sequence),name=roomName(text);
          if(name){
            const left=Math.min(...sequence.map(i=>i.x)),right=Math.max(...sequence.map(i=>i.x+i.width));
            candidates.push({name,area:areaIn(text),dimensions:dimensionsIn(text),x:left,y:start.y,width:right-left,height:Math.max(...sequence.map(i=>i.height)),ids:sequence.map(i=>i.id),inlineFloor:floorIn(start.text.split(/\s/)[0])});
          }
          const next=items.filter(item=>!sequence.includes(item)).map(item=>{
            const font=Math.max(item.height,current.height,6);
            const gap=axis==='horizontal'?item.x-(current.x+current.width):current.y-item.y-current.height;
            const aligned=axis==='horizontal'?Math.abs(item.y-current.y)<=Math.max(2,font*.3):Math.abs(item.x-current.x)<=Math.max(2,font*.3);
            return {item,gap,aligned,font};
          }).filter(n=>n.aligned&&n.gap>=-1&&n.gap<=Math.max(4,n.font*.9)).sort((a,b)=>a.gap-b.gap)[0];
          // A bare number below a label is commonly an area or a dimension,
          // not a room-number suffix. Join suffixes on the same baseline only.
          if(!next||(axis==='vertical'&&/^\d+(?:[.,]\d+)?$/.test(next.item.text)))break;
          sequence.push(next.item);current=next.item;
        }
      });
    });
    const used=new Set(),labels=[],tableRows=[];
    candidates.sort((a,b)=>b.ids.length-a.ids.length||(b.area!==null)-(a.area!==null));
    candidates.forEach(candidate=>{
      if(candidate.ids.some(id=>used.has(id)))return;
      if(!washroomCandidateAllowed(candidate,items))return;
      // A/B/C classification plus an area/expression cell identifies a table
      // row even when the plan and its area table share the same PDF page.
      const type=items.find(i=>/^[ABC]$/.test(i.text)&&i.x>candidate.x&&Math.abs(i.y-candidate.y)<2);
      // A diagram label can share a baseline with a distant table row. The
      // intervening room label owns that row; do not enlarge the table block
      // across the diagram merely because a numeric and A/B/C cell lie right.
      const intervening=type&&candidates.some(other=>other!==candidate&&other.x>candidate.x+candidate.width-1&&other.x<type.x&&Math.abs(other.y-candidate.y)<2);
      if(type&&!intervening&&items.some(i=>i.x>candidate.x&&i.x<type.x&&Math.abs(i.y-candidate.y)<2&&numericTableCell(i.text))){
        if(!tableRows.some(r=>Math.abs(r.x-candidate.x)<1&&Math.abs(r.y-candidate.y)<1))tableRows.push({x:candidate.x,y:candidate.y,right:Math.max(candidate.x+candidate.width,type.x+type.width),height:candidate.height});
        return;
      }
      if(labels.some(label=>label.name===candidate.name&&Math.abs(label.x-candidate.x)<.8&&Math.abs(label.y-candidate.y)<.8))return;
      candidate.ids.forEach(id=>used.add(id));labels.push(candidate);
    });
    labels.tableRows=tableRows;
    return labels.sort((a,b)=>b.y-a.y||a.x-b.x);
  }
  function floorsFor(labels,marks,width,height){
    if(marks.length===1){
      const mark=marks[0];
      // A standalone floor token may belong to just one of several diagrams.
      // Only an explicit plan heading applies to the whole page; otherwise
      // require local evidence and leave distant room floors unresolved.
      return labels.map(label=>label.inlineFloor||(mark.planHeading||Math.hypot((label.x-mark.x)/width,(label.y-mark.y)/height)<.13?mark.floor:''));
    }
    if(!marks.length)return labels.map(label=>label.inlineFloor||'');
    const xSpan=(Math.max(...marks.map(m=>m.x))-Math.min(...marks.map(m=>m.x)))/width;
    const ySpan=(Math.max(...marks.map(m=>m.y))-Math.min(...marks.map(m=>m.y)))/height;
    const axis=xSpan>=ySpan?'x':'y',extent=axis==='x'?width:height;
    const ordered=labels.map((label,index)=>({label,index})).sort((a,b)=>a.label[axis]-b.label[axis]);
    const gaps=ordered.slice(1).map((row,i)=>({index:i,value:row.label[axis]-ordered[i].label[axis]})).sort((a,b)=>b.value-a.value);
    const splits=gaps.slice(0,marks.length-1),next=gaps[marks.length-1];
    const clusterable=ordered.length>=marks.length&&splits.length===marks.length-1&&splits.every(s=>s.value>extent*.025)&&(!next||Math.min(...splits.map(s=>s.value))>next.value*1.8);
    const floors=labels.map(label=>label.inlineFloor||'');
    if(clusterable){
      const boundaries=splits.map(s=>s.index).sort((a,b)=>a-b),anchors=marks.slice().sort((a,b)=>a[axis]-b[axis]);let group=0;
      ordered.forEach((entry,i)=>{if(!floors[entry.index])floors[entry.index]=anchors[group].floor;if(boundaries.includes(i))group++;});
      return floors;
    }
    labels.forEach((label,index)=>{
      if(floors[index])return;
      const distances=marks.map(mark=>({floor:mark.floor,d:Math.hypot((label.x-mark.x)/width,(label.y-mark.y)/height)})).sort((a,b)=>a.d-b.d);
      if(distances[0].d<.13&&distances[1].d>distances[0].d*1.8+.015)floors[index]=distances[0].floor;
    });
    return floors;
  }
  function mergedTableFloors(items,peers,pageWidth){
    const sample=peers[0],font=sample.height,near=(a,b,tolerance)=>Math.abs(a-b)<=tolerance;
    const grid=[];
    items.filter(i=>/^[ABC]$/.test(i.text)&&near(i.x,sample.typeX,Math.max(3,font*.5))).forEach(type=>{
      const named=items.some(i=>i.x<type.x&&near(i.y,type.y,Math.max(2,font*.25))&&near(i.x,sample.nameX,Math.max(6,font))&&roomName(i.text));
      if(named&&!grid.some(y=>near(y,type.y,1)))grid.push(type.y);
    });
    grid.sort((a,b)=>b-a);if(grid.length<2)return null;
    const gaps=grid.slice(1).map((y,i)=>grid[i]-y).sort((a,b)=>a-b),pitch=gaps[Math.floor(gaps.length/2)];
    if(!(pitch>font*.6)||gaps.some(gap=>Math.abs(gap-pitch)>Math.max(.5,pitch*.08)))return null;
    const headers=items.filter(i=>/^(?:階|階数)$/.test(i.text.replace(/\s/g,''))&&i.x<sample.nameX&&sample.nameX-i.x<Math.max(32,pageWidth*.15)&&i.y>=grid[0]-font);
    const proposals=[];
    headers.forEach(header=>{
      const markers=[];
      items.forEach(item=>{
        const floor=/^[1-9]$/.test(item.text)?item.text:floorIn(item.text);
        if(!/^[1-9]$/.test(floor)||item.x>=sample.nameX||!near(item.x+item.width/2,header.x+header.width/2,Math.max(8,font))||item.y>grid[0]+pitch*.5||item.y<grid[grid.length-1]-pitch*.5)return;
        if(!markers.some(m=>m.floor===floor&&near(m.y,item.y,1)))markers.push({floor,y:item.y});
      });
      markers.sort((a,b)=>b.y-a.y);
      // Two complete, consecutive floor bands are validated as a whole. No
      // nearest-marker interpolation or guessed boundary is used.
      if(markers.length!==2||Number(markers[1].floor)!==Number(markers[0].floor)+1)return;
      const partitions=[];
      for(let split=1;split<grid.length;split++){
        const first=(grid[0]+grid[split-1])/2,second=(grid[split]+grid[grid.length-1])/2;
        if(near(first,markers[0].y,pitch*.25)&&near(second,markers[1].y,pitch*.25))partitions.push(split);
      }
      if(partitions.length!==1)return;
      proposals.push(new Map(grid.map((y,index)=>[y,markers[index<partitions[0]?0:1].floor])));
    });
    if(proposals.length!==1)return null;
    return proposals[0];
  }
  function ruledTableFloors(items,peers,page){
    const absent={present:false,map:new Map()};
    if(!Array.isArray(page.rulingLines))return absent;
    const result={present:true,map:new Map(),code:'TABLE_FLOOR_CELL_UNRESOLVED'};
    if(!peers.length||page.rulingLines.length>50000||page.rulingLineStatus?.complete===false){result.code='TABLE_FLOOR_RULES_INCOMPLETE';return result;}
    const font=Math.max(...peers.map(r=>r.height)),sample=peers[0],epsilon=.2;
    const horizontal=[],vertical=[];
    for(const line of page.rulingLines){
      if(!line||!['x1','y1','x2','y2'].every(k=>Number.isFinite(line[k])))continue;
      if(Math.abs(line.y1-line.y2)<=epsilon&&Math.abs(line.x1-line.x2)>1)horizontal.push({at:(line.y1+line.y2)/2,lo:Math.min(line.x1,line.x2),hi:Math.max(line.x1,line.x2)});
      else if(Math.abs(line.x1-line.x2)<=epsilon&&Math.abs(line.y1-line.y2)>1)vertical.push({at:(line.x1+line.x2)/2,lo:Math.min(line.y1,line.y2),hi:Math.max(line.y1,line.y2)});
    }
    const coverage=(segments,at,lo,hi)=>{
      const spans=segments.filter(s=>Math.abs(s.at-at)<=epsilon&&s.hi>=lo-epsilon&&s.lo<=hi+epsilon).sort((a,b)=>a.lo-b.lo);
      let end=lo;for(const span of spans){if(span.lo>end+epsilon)return false;end=Math.max(end,span.hi);if(end>=hi-epsilon)return true;}return false;
    };
    const distinct=values=>{const out=[];values.slice().sort((a,b)=>a-b).forEach(v=>{if(!out.length||v-out[out.length-1]>epsilon)out.push(v);});return out;};
    const low=Math.min(...peers.map(r=>r.rowY)),high=Math.max(...peers.map(r=>r.rowY+r.height));
    const xs=distinct(vertical.map(s=>s.at)).filter(x=>coverage(vertical,x,low,high));
    const headers=items.filter(i=>/^(?:階|階数)$/.test(i.text.replace(/\s/g,''))&&i.x<sample.nameX&&sample.nameX-i.x<Math.max(32,(Number(page.width)||600)*.15)&&i.y>=high-font*2);
    const proposals=[];
    for(const header of headers){
      const left=xs.filter(x=>x<header.x+epsilon).pop(),right=xs.find(x=>x>header.x+header.width-epsilon&&x<=sample.nameX+epsilon);
      if(left===undefined||right===undefined||right-left>Math.max(font*8,(Number(page.width)||600)*.15))continue;
      const ys=distinct(horizontal.map(s=>s.at)).filter(y=>coverage(horizontal,y,left,right));
      const markers=items.map(i=>({item:i,floor:/^[1-9]$/.test(i.text)?i.text:floorIn(i.text)})).filter(m=>/^[1-9]$/.test(m.floor)&&m.item.x>=left-epsilon&&m.item.x+m.item.width<=right+epsilon);
      const map=new Map();
      for(let index=0;index<ys.length-1;index++){
        const bottom=ys[index],top=ys[index+1];
        if(top-bottom<font||!coverage(vertical,left,bottom,top)||!coverage(vertical,right,bottom,top))continue;
        const floors=[...new Set(markers.filter(m=>m.item.y>bottom+epsilon&&m.item.y+m.item.height<top-epsilon).map(m=>m.floor))];
        if(floors.length!==1)continue;
        for(const row of peers)if(row.rowY>bottom+epsilon&&row.rowY+row.height<top-epsilon)map.set(row.rowY,floors[0]);
      }
      if(map.size&&!proposals.some(prior=>prior.size===map.size&&[...prior].every(([y,f])=>map.get(y)===f)))proposals.push(map);
    }
    if(proposals.length===1){result.map=proposals[0];result.code='TABLE_FLOOR_RULED_CELLS';}
    else if(proposals.length>1)result.code='TABLE_FLOOR_CELLS_AMBIGUOUS';
    return result;
  }
  function parseRoomTable(layoutPages){
    const rooms=[],diagnostics=[];
    (Array.isArray(layoutPages)?layoutPages:[]).forEach((page,index)=>{
      const items=positioned(page),text=items.map(i=>i.text).concat((page.lines||[]).map(l=>normalize(l.text||l.compact))).join('').replace(/\s/g,'');
      // The fixed table heading and repeated numeric/type columns are both
      // required. An arithmetic expression is never evaluated as an area.
      if(!text.includes('居室区画面積表'))return;
      const pageNumber=Number(page.number)||index+1,candidates=[],floorCache=new Map();
      items.filter(i=>/^[ABC]$/.test(i.text)).forEach(type=>{
        const row=items.filter(i=>i.id!==type.id&&i.x<type.x&&Math.abs(i.y-type.y)<Math.max(2,type.height*.25)).sort((a,b)=>b.x-a.x);
        const prior=row[0];if(!prior)return;
        if(new Set(row.filter(i=>Math.abs(i.x-prior.x)<.8).map(i=>i.text)).size>1)return;
        const explicit=areaIn(prior.text),area=explicit??(/^\d+(?:\.\d+)?$/.test(prior.text)?Number(prior.text):null);
        if(!(area>0&&area<10000))return;
        const before=row.filter(i=>i.x<prior.x).sort((a,b)=>b.x-a.x)[0];
        if(before&&prior.x-before.x-before.width<=Math.max(4,prior.height*.6)&&/[+\-*×xX÷/=]\s*$/.test(before.text))return;
        const named=row.filter(i=>i.x<prior.x&&roomName(i.text)).sort((a,b)=>b.x-a.x)[0];
        if(!named)return;
        const name=roomName(named.text);
        if(!washroomCandidateAllowed({name,area:null,x:named.x,y:named.y,width:named.width,height:named.height,ids:[named.id]},items))return;
        candidates.push({name,area,type:type.text,floor:'',sourceKind:'table',sourcePage:pageNumber,areaSource:'table',tableParsed:true,areaRight:prior.x+prior.width,typeX:type.x,nameX:named.x,rowY:type.y,height:Math.max(type.height,prior.height)});
      });
      candidates.forEach(candidate=>{
        const peers=candidates.filter(other=>Math.abs(other.typeX-candidate.typeX)<=Math.max(3,candidate.height*.5)&&Math.abs(other.areaRight-candidate.areaRight)<=Math.max(6,candidate.height)&&Math.abs(other.nameX-candidate.nameX)<=Math.max(6,candidate.height));
        const areaHeader=items.some(i=>/^(?:床)?面積(?:\(m2\))?$/.test(i.text.replace(/\s/g,''))&&Math.abs(i.x+i.width-candidate.areaRight)<Math.max(12,candidate.height*2));
        const repeated=peers.some(other=>Math.abs(other.rowY-candidate.rowY)>Math.max(2,candidate.height*.5));
        if(!repeated&&!areaHeader)return;
        const {areaRight,typeX,nameX,rowY,height,...room}=candidate;
        const cacheKey=peers.map(p=>p.rowY).sort((a,b)=>a-b).join(',')+'|'+nameX+'|'+typeX;
        let ruled=floorCache.get(cacheKey);
        if(!ruled){ruled=ruledTableFloors(items,peers,page);floorCache.set(cacheKey,ruled);if(ruled.present&&ruled.code!=='TABLE_FLOOR_RULED_CELLS')diagnostics.push({code:ruled.code,page:pageNumber,count:peers.length});}
        if(ruled.present){
          const floor=ruled.map.get(rowY);
          if(floor){room.floor=floor;room.tableFloorColumn=true;room.tableFloorEvidence='ruled-merged-cell';}
          if(!rooms.some(r=>r.name===room.name&&r.floor===room.floor&&r.area===room.area&&r.type===room.type&&r.sourcePage===room.sourcePage))rooms.push(room);
          return;
        }
        const floorCells=items.filter(i=>i.x<nameX&&nameX-i.x<Math.max(32,(Number(page.width)||600)*.15)&&Math.abs(i.y-rowY)<Math.max(2,height*.3)&&(/^[1-9]$/.test(i.text)||/^[1-9]$/.test(floorIn(i.text))));
        const confirmed=floorCells.filter(cell=>items.some(header=>/^(?:階|階数)$/.test(header.text.replace(/\s/g,''))&&Math.abs(header.x+header.width/2-cell.x-cell.width/2)<Math.max(8,height)&&header.y>=Math.max(...peers.map(p=>p.rowY))-height));
        const floors=[...new Set(confirmed.map(cell=>/^[1-9]$/.test(cell.text)?cell.text:floorIn(cell.text)))];
        if(floors.length===1){room.floor=floors[0];room.tableFloorColumn=true;}
        const merged=mergedTableFloors(items,peers,Number(page.width)||600),mergedFloor=merged&&[...merged].find(([y])=>Math.abs(y-rowY)<1)?.[1];
        if(mergedFloor){room.floor=mergedFloor;room.tableFloorColumn=true;room.tableFloorEvidence='validated-merged-centres';}
        if(!rooms.some(r=>r.name===room.name&&r.floor===room.floor&&r.area===room.area&&r.type===room.type&&r.sourcePage===room.sourcePage))rooms.push(room);
      });
    });
    return {rooms,diagnostics};
  }
  function parse(layoutPages,tableInput=[]){
    const pages=Array.isArray(layoutPages)?layoutPages:[],inputTable=Array.isArray(tableInput)?tableInput:tableInput.rooms||[];
    const dynamicTable=parseRoomTable(pages),table=[];
    inputTable.concat(dynamicTable.rooms).forEach(room=>{
      const name=roomName(room.name),floor=safeFloor(room.floor),area=Number(room.area),type=room.type;
      if(!table.some(prior=>roomName(prior.name)===name&&safeFloor(prior.floor)===floor&&Number(prior.area)===area&&prior.type===type))table.push(room);
    });
    const rooms=[],selected=[],diagnostics=[];
    const last=Math.max(0,...pages.map((p,i)=>Number(p.number)||i+1));
    const report=(code,page,extra={})=>diagnostics.push({code,page,...extra});
    pages.forEach((page,index)=>{
      const number=Number(page.number)||index+1,width=Number(page.width)||600,height=Number(page.height)||800;
      const items=positioned(page),candidates=labelCandidates(items,page);
      let labels=candidates,areas=areaCandidates(items),inTableBlock=()=>false;
      if(!labels.length)return;
      const text=items.map(i=>i.text).concat((page.lines||[]).map(l=>normalize(l.text||l.compact))).join('\n');
      const heading=hasPlanHeading(text),tableHeading=/居室区画面積表|求積表|面積計算表/.test(text.replace(/\s/g,''));
      const tableRows=candidates.tableRows||[];
      if(tableHeading&&tableRows.length){
        const minX=Math.min(...tableRows.map(r=>r.x)),maxX=Math.max(...tableRows.map(r=>r.right));
        const minY=Math.min(...tableRows.map(r=>r.y-r.height)),maxY=Math.max(...tableRows.map(r=>r.y+r.height));
        // Include the narrow floor/merged-cell column preceding room names.
        // Its 1F/2F values describe table rows, never diagram placement.
        const left=minX-Math.max(32,(maxX-minX)*.5);
        inTableBlock=item=>item.x+item.width>=left-3&&item.x<=maxX+3&&item.y>=minY-3&&item.y<=maxY+3;
        // Rows with missing A/B/C or missing area cells still belong to the
        // same table block; they must not become physical plan rooms.
        labels=candidates.filter(label=>!inTableBlock(label));
        areas=areas.filter(area=>!inTableBlock(area));
      }
      if(!labels.length)return;
      const marks=[];
      items.forEach(item=>{
        if(inTableBlock(item))return;
        const floor=floorIn(item.text);if(!floor)return;
        const planHeading=hasPlanHeading(item.text)||/\bPLAN\b/i.test(item.text),prior=marks.find(m=>m.floor===floor);
        if(!prior)marks.push({floor,x:item.x,y:item.y,planHeading});
        else if(planHeading&&!prior.planHeading)Object.assign(prior,{x:item.x,y:item.y,planHeading:true});
      });
      const dimensions=items.filter(i=>!inTableBlock(i)&&(/^\d{3,5}$/.test(i.text)||/^\d+(?:\.\d+)?\s*(?:mm|m)$/i.test(i.text))).length;
      const spreadX=(Math.max(...labels.map(l=>l.x))-Math.min(...labels.map(l=>l.x)))/width;
      const spreadY=(Math.max(...labels.map(l=>l.y))-Math.min(...labels.map(l=>l.y)))/height;
      const positional=number===8||number===last,distributed=spreadX>.12||spreadY>.18;
      const mixedPage=tableHeading&&tableRows.length>0&&positional&&labels.length>=2&&distributed;
      if(tableHeading&&!heading&&!mixedPage)return;
      if(!heading&&!mixedPage&&!(positional&&((labels.length>=2&&distributed&&(marks.length||dimensions>=2))||(labels.length===1&&marks.length&&dimensions>=2)))&&!(marks.length&&labels.length>=3&&spreadX>.12))return;
      selected.push(number);const floors=floorsFor(labels,marks,width,height);
      const usedAreas=new Set();
      labels.forEach((label,li)=>{
        let area=label.area;
        if(area===null){
          const candidates=areas.filter(item=>!item.ids.some(id=>usedAreas.has(id))&&!labels.some(other=>other!==label&&item.ids.some(id=>other.ids.includes(id)))).map(item=>{
            const value=item.value,d=Math.hypot((item.x+item.width/2)-(label.x+label.width/2),item.y-label.y);
            return {item,value,d,explicit:item.explicit};
          }).filter(a=>a.value>0&&a.value<10000&&a.d<=Math.max(18,label.height*3.2)&&Math.abs(a.item.x-label.x)<width*.085).sort((a,b)=>a.d-b.d);
          const best=candidates[0],other=candidates[1];
          if(best&&(!other||other.d>best.d*1.25+2)){
            const contested=labels.some(otherLabel=>otherLabel!==label&&otherLabel.area===null&&Math.hypot(best.item.x-otherLabel.x,best.item.y-otherLabel.y)<=best.d+2);
            if(!contested){area=best.value;best.item.ids.forEach(id=>usedAreas.add(id));}else report('PLAN_AREA_AMBIGUOUS',number);
          }else if(best)report('PLAN_AREA_AMBIGUOUS',number);
        }
        const dims=label.dimensions,compound=!!(dims&&area!==null&&Math.abs(dims.dx*dims.dy-area)>.12);
        const room={name:label.name,floor:floors[li],area,type:null,sourceKind:'plan',sourcePage:number,plan:{x:label.x,y:label.y,width:label.width,height:label.height},areaSource:area===null?null:'plan',dx:dims&&!compound?dims.dx:null,dy:dims&&!compound?dims.dy:null,compound};
        if(!room.floor&&marks.length)room.floorEvidenceIncomplete=true;
        room.key='plan:'+number+':'+(room.floor||'?')+':'+Math.round(label.x*10)+':'+Math.round(label.y*10);
        rooms.push(room);
      });
    });
    const safeTable=table.map((room,index)=>({room,index,name:roomName(room.name),floor:safeFloor(room.floor)})).filter(item=>item.name);
    const usedTable=new Set();
    rooms.forEach(room=>{
      const hadPlanArea=room.area!==null&&room.areaSource==='plan';
      let candidates=safeTable.filter(t=>t.name===room.name&&(!room.floor||!t.floor||room.floor===t.floor));
      if(room.area!==null){const close=candidates.filter(t=>Number(t.room.area)>0&&Math.abs(Number(t.room.area)-room.area)<.12);if(close.length)candidates=close;}
      const unique=candidates.length===1?candidates[0]:null;
      const same=candidates.length>1&&candidates.every(t=>Number(t.room.area)===Number(candidates[0].room.area)&&t.room.type===candidates[0].room.type);
      const match=unique||(same?candidates[0]:null);
      if(match){
        const value=Number(match.room.area),conflict=room.area!==null&&value>0&&Math.abs(room.area-value)>=.12;
        const peers=rooms.filter(r=>r.name===room.name&&(!r.floor||!match.floor||r.floor===match.floor));
        const aggregate=room.area===null&&unique&&peers.length>1;
        if(conflict)report('PLAN_TABLE_AREA_DIFFERENCE',room.sourcePage,{roomKey:room.key});
        else if(aggregate){
          if(Number.isFinite(value)&&value>0){room.tableAreaTotal=value;room.tableSourcePage=Number(match.room.sourcePage)||null;}
          report('PLAN_TABLE_GROUP_AREA',room.sourcePage,{roomKey:room.key,count:peers.length});
        }
        else{
          if(room.area===null&&Number.isFinite(value)&&value>0){room.area=value;room.areaSource='table';room.tableSourcePage=Number(match.room.sourcePage)||null;}
          const ruledIdentity=unique&&match.room.tableFloorEvidence==='ruled-merged-cell'&&rooms.filter(peer=>peer.name===room.name&&(!peer.floor||peer.floor===match.floor)&&
            (peer.area===null||!(Number(match.room.area)>0)||Math.abs(peer.area-Number(match.room.area))<.12)).length===1;
          if(!room.floor&&(!room.floorEvidenceIncomplete||ruledIdentity)&&unique&&match.floor&&(!match.room.tableParsed||hadPlanArea||match.room.tableFloorColumn)){
            room.floor=match.floor;room.floorSource='table';if(ruledIdentity){delete room.floorEvidenceIncomplete;room.floorEvidence='ruled-merged-cell';}
          }
          if(/^[ABC]$/.test(match.room.type||''))room.type=match.room.type;
          if(unique)usedTable.add(match.index);
        }
      }else if(candidates.length>1)report('PLAN_TABLE_MATCH_AMBIGUOUS',room.sourcePage,{roomKey:room.key});
      if(!room.floor)report('PLAN_FLOOR_UNKNOWN',room.sourcePage,{roomKey:room.key});
      if(room.area===null)report('PLAN_AREA_UNKNOWN',room.sourcePage,{roomKey:room.key});
    });
    const unmatchedTableRooms=safeTable.filter(t=>!usedTable.has(t.index)&&!rooms.some(r=>r.name===t.name&&(!r.floor||!t.floor||r.floor===t.floor))).map(t=>({name:t.name,floor:t.floor,area:Number.isFinite(Number(t.room.area))&&Number(t.room.area)>0?Number(t.room.area):null,type:/^[ABC]$/.test(t.room.type||'')?t.room.type:null,sourceKind:'table',sourcePage:Number(t.room.sourcePage)||null}));
    if(selected.length&&unmatchedTableRooms.length)report('TABLE_ROOMS_NOT_IN_PLAN',0,{count:unmatchedTableRooms.length});
    if(selected.length&&safeTable.length>rooms.length)report('TABLE_ROOM_COUNT_DIFFERENCE',0,{count:safeTable.length-rooms.length});
    const warnings=[];
    if(diagnostics.some(d=>d.code==='PLAN_AREA_UNKNOWN'||d.code==='PLAN_AREA_AMBIGUOUS'))warnings.push('平面図で面積を確定できない部屋があります。面積表または手入力で確認してください。');
    if(diagnostics.some(d=>d.code==='PLAN_FLOOR_UNKNOWN'))warnings.push('平面図で階を確定できない部屋があります。配置と階を確認してください。');
    if(diagnostics.some(d=>d.code==='PLAN_TABLE_AREA_DIFFERENCE'||d.code==='PLAN_TABLE_MATCH_AMBIGUOUS'))warnings.push('平面図と面積表の対応を一意に確認できない部屋があります。平面図の部屋名を保持しました。');
    if(diagnostics.some(d=>d.code==='PLAN_TABLE_GROUP_AREA'))warnings.push('面積表が同名の複数室をまとめている可能性があるため、個別面積を自動配分していません。');
    if(diagnostics.some(d=>d.code==='TABLE_ROOM_COUNT_DIFFERENCE'))warnings.push('面積表より平面図の部屋名の取得件数が少ないため、未取得の部屋がないか確認してください。');
    return {rooms,pages:[...new Set(selected)],diagnostics,warnings,unmatchedTableRooms};
  }
  root.parseArchitrendPlanRooms=parse;
  root.parseArchitrendRoomTable=parseRoomTable;
  root.normalizeArchitrendPlanRoomName=roomName;
  if(typeof module!=='undefined'&&module.exports)module.exports={parseArchitrendPlanRooms:parse,parseArchitrendRoomTable:parseRoomTable,normalizeArchitrendPlanRoomName:roomName};
})(typeof window!=='undefined'?window:globalThis);
