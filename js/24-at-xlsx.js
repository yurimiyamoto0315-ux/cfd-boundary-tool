// Local OOXML table reader. No formulas, links, scripts or network resources are executed.
(function(global){
  'use strict';
  const LIMIT={file:16*1024*1024,entries:256,expanded:48*1024*1024,entry:16*1024*1024,rows:10000,columns:128,cells:100000,text:32767,csv:8*1024*1024};
  const MAIN=new Set(['http://schemas.openxmlformats.org/spreadsheetml/2006/main','http://purl.oclc.org/ooxml/spreadsheetml/main']);
  const REL='http://schemas.openxmlformats.org/package/2006/relationships';
  const OFFICE=['http://schemas.openxmlformats.org/officeDocument/2006/relationships/','http://purl.oclc.org/ooxml/officeDocument/relationships/'];
  const MESSAGES={
    XLSX_FORMAT_UNSUPPORTED:'Excel の .xlsx ファイルを選んでください。.xls・マクロ付き形式には対応していません。',
    XLSX_LIMIT:'ファイルまたは表が読込上限を超えています。外皮表だけを新しい .xlsx に保存してください。',
    XLSX_ZIP_INVALID:'Excel ファイルの構造を確認できません。Excel で開き直し、.xlsx で保存してください。',
    XLSX_ZIP_METHOD:'この Excel の圧縮方式には対応していません。Excel から .xlsx で保存し直してください。',
    XLSX_ZIP_CRC:'Excel ファイルの内容が壊れている可能性があります。元のファイルを保存し直してください。',
    XLSX_XML_INVALID:'Excel 内の表を読み取れません。Excel で開き直し、.xlsx で保存してください。',
    XLSX_XML_UNSAFE:'外部定義を含む Excel は読み込めません。外皮表だけを新しい .xlsx にコピーしてください。',
    XLSX_EXTERNAL_REFERENCE:'外部ファイルへの参照があります。外皮表を値だけで新しい .xlsx にコピーしてください。',
    XLSX_PATH_INVALID:'Excel 内の参照先が通常の保存形式と異なります。Excel から保存し直してください。',
    XLSX_PART_UNSUPPORTED:'マクロ・埋込オブジェクト・外部データを含む Excel は未対応です。外皮表だけを .xlsx で保存してください。',
    XLSX_BROWSER_UNSUPPORTED:'このブラウザでは Excel を展開できません。新しい Edge・Chrome を使うか、CSV で保存してください。',
    XLSX_CELL_INVALID:'表のセルを読み取れません。数値やセルの並びを確認し、Excel から保存し直してください。',
    XLSX_CELL_ERROR:'外皮表に Excel の計算エラーがあります。Excel でエラーを直して保存してください。',
    XLSX_FORMULA_CACHE_MISSING:'数式の計算結果が保存されていません。Excel で再計算して保存するか、値だけにして保存してください。',
    XLSX_TABLE_MISSING:'部位・名称・面積・貫流熱損失の見出しがそろう外皮表を確認できません。標準の外皮表か CSV を選んでください。',
    XLSX_TABLE_AMBIGUOUS:'外皮表の候補が複数あります。使用する外皮表だけを新しい1シートにコピーして保存してください。',
    XLSX_READ_FAILED:'Excel を読み取れませんでした。Excel で開けることを確認して保存し直してください。'
  };
  function fail(code){const error=new Error(MESSAGES[code]||MESSAGES.XLSX_READ_FAILED);error.code=code;throw error;}
  function requireValue(value,code){if(!value)fail(code);}
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xEDB88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let n=0xFFFFFFFF;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xFFFFFFFF)>>>0;}
  function utf8(bytes,code){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch(error){fail(code);}}
  function zipName(bytes){
    const name=utf8(bytes,'XLSX_PATH_INVALID');
    requireValue(name.length>0&&name.length<=512&&!/[\\\u0000-\u0020%:#?]/.test(name)&&!name.startsWith('/'),'XLSX_PATH_INVALID');
    const parts=name.replace(/\/$/,'').split('/');requireValue(parts.every(p=>p&&p!=='.'&&p!=='..'),'XLSX_PATH_INVALID');return name;
  }
  function extraValid(bytes,start,length){
    const end=start+length;for(let p=start;p<end;){requireValue(p+4<=end,'XLSX_ZIP_INVALID');const id=bytes.getUint16(p,true),size=bytes.getUint16(p+2,true);requireValue(p+4+size<=end,'XLSX_ZIP_INVALID');requireValue(id!==1&&id!==0x9901,'XLSX_FORMAT_UNSUPPORTED');p+=4+size;}
  }
  async function unzip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=bytes.length;
    requireValue(length>=22&&view.getUint32(0,true)===0x04034B50,'XLSX_FORMAT_UNSUPPORTED');
    let eocd=-1;for(let p=length-22;p>=Math.max(0,length-65557);p--)if(view.getUint32(p,true)===0x06054B50&&p+22+view.getUint16(p+20,true)===length){eocd=p;break;}
    requireValue(eocd>=0,'XLSX_ZIP_INVALID');
    const count=view.getUint16(eocd+10,true),size=view.getUint32(eocd+12,true),offset=view.getUint32(eocd+16,true);
    requireValue(view.getUint16(eocd+4,true)===0&&view.getUint16(eocd+6,true)===0&&view.getUint16(eocd+8,true)===count&&count!==0xFFFF&&size!==0xFFFFFFFF&&offset!==0xFFFFFFFF,'XLSX_FORMAT_UNSUPPORTED');
    requireValue(count>0&&count<=LIMIT.entries,'XLSX_LIMIT');requireValue(offset+size===eocd,'XLSX_ZIP_INVALID');
    const entries=[],names=new Set();let p=offset,total=0;
    for(let i=0;i<count;i++){
      requireValue(p+46<=eocd&&view.getUint32(p,true)===0x02014B50,'XLSX_ZIP_INVALID');
      const flags=view.getUint16(p+8,true),method=view.getUint16(p+10,true),crc=view.getUint32(p+16,true),compressed=view.getUint32(p+20,true),expanded=view.getUint32(p+24,true),n=view.getUint16(p+28,true),x=view.getUint16(p+30,true),c=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
      requireValue(p+46+n+x+c<=eocd&&n>0,'XLSX_ZIP_INVALID');
      requireValue((flags&~0x080E)===0&&view.getUint16(p+34,true)===0&&((view.getUint32(p+38,true)>>>16)&0xF000)!==0xA000,'XLSX_FORMAT_UNSUPPORTED');
      requireValue(method===0||method===8,'XLSX_ZIP_METHOD');requireValue(method!==0||(flags&6)===0,'XLSX_ZIP_INVALID');
      requireValue(compressed!==0xFFFFFFFF&&expanded!==0xFFFFFFFF&&local!==0xFFFFFFFF,'XLSX_FORMAT_UNSUPPORTED');
      total+=expanded;requireValue(expanded<=LIMIT.entry&&total<=LIMIT.expanded,'XLSX_LIMIT');
      const name=zipName(bytes.subarray(p+46,p+46+n));requireValue(!names.has(name.toLowerCase()),'XLSX_ZIP_INVALID');names.add(name.toLowerCase());extraValid(view,p+46+n,x);
      requireValue(local+30<=offset&&view.getUint32(local,true)===0x04034B50,'XLSX_ZIP_INVALID');
      const ln=view.getUint16(local+26,true),lx=view.getUint16(local+28,true),start=local+30+ln+lx;
      requireValue(start+compressed<=offset&&ln>0&&view.getUint16(local+6,true)===flags&&view.getUint16(local+8,true)===method,'XLSX_ZIP_INVALID');
      requireValue(zipName(bytes.subarray(local+30,local+30+ln))===name,'XLSX_ZIP_INVALID');extraValid(view,local+30+ln,lx);
      for(const [at,expected]of [[14,crc],[18,compressed],[22,expanded]])requireValue(view.getUint32(local+at,true)===expected||((flags&8)!==0&&view.getUint32(local+at,true)===0),'XLSX_ZIP_INVALID');
      let stop=start+compressed;
      if(flags&8){requireValue(stop+12<=offset,'XLSX_ZIP_INVALID');if(view.getUint32(stop,true)===0x08074B50)stop+=4;requireValue(stop+12<=offset&&view.getUint32(stop,true)===crc&&view.getUint32(stop+4,true)===compressed&&view.getUint32(stop+8,true)===expanded,'XLSX_ZIP_INVALID');stop+=12;}
      requireValue(!name.endsWith('/')||expanded===0,'XLSX_ZIP_INVALID');
      entries.push({name,method,crc,compressed,expanded,local,start,stop});p+=46+n+x+c;
    }
    requireValue(p===eocd,'XLSX_ZIP_INVALID');let next=0;
    for(const entry of [...entries].sort((a,b)=>a.local-b.local)){requireValue(entry.local===next,'XLSX_ZIP_INVALID');next=entry.stop;}requireValue(next===offset,'XLSX_ZIP_INVALID');
    const result=new Map();
    for(const entry of entries){
      const data=bytes.subarray(entry.start,entry.start+entry.compressed);let expanded;
      if(entry.method===0){requireValue(entry.compressed===entry.expanded,'XLSX_ZIP_INVALID');expanded=data;}
      else{
        let decompressor;try{decompressor=new DecompressionStream('deflate-raw');}catch(error){fail('XLSX_BROWSER_UNSUPPORTED');}
        const reader=new Blob([data]).stream().pipeThrough(decompressor).getReader(),chunks=[];let seen=0;
        try{while(true){const part=await reader.read();if(part.done)break;seen+=part.value.length;if(seen>entry.expanded||seen>LIMIT.entry){await reader.cancel();fail('XLSX_ZIP_INVALID');}chunks.push(part.value);}}
        catch(error){if(error.code)throw error;fail('XLSX_ZIP_INVALID');}
        requireValue(seen===entry.expanded,'XLSX_ZIP_INVALID');expanded=new Uint8Array(seen);let at=0;for(const chunk of chunks){expanded.set(chunk,at);at+=chunk.length;}
      }
      requireValue(crc32(expanded)===entry.crc,'XLSX_ZIP_CRC');result.set(entry.name,expanded);
    }
    return result;
  }
  function xml(bytes){
    const text=utf8(bytes,'XLSX_XML_INVALID');requireValue(!/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)&&!/<\?xml-stylesheet\b/i.test(text),'XLSX_XML_UNSAFE');
    const declaration=text.match(/^\uFEFF?\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i);requireValue(!declaration||/^(?:utf-8|us-ascii)$/i.test(declaration[1]),'XLSX_XML_INVALID');
    const doc=new DOMParser().parseFromString(text,'application/xml');requireValue(doc.documentElement&&!doc.getElementsByTagName('parsererror').length&&!doc.getElementsByTagNameNS('*','parsererror').length,'XLSX_XML_INVALID');return doc;
  }
  const children=(node,name,ns)=>[...node.children].filter(n=>n.localName===name&&(!ns||n.namespaceURI===ns));
  function one(node,name,ns){const all=children(node,name,ns);requireValue(all.length<=1,'XLSX_XML_INVALID');return all[0]||null;}
  function resolvePart(base,target){
    requireValue(target&&!/[\\\u0000-\u0020%?#:]/.test(target)&&!target.startsWith('//'),'XLSX_PATH_INVALID');
    const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);
    for(const part of target.replace(/^\//,'').split('/')){requireValue(part!=='','XLSX_PATH_INVALID');if(part==='.')continue;if(part==='..'){requireValue(parts.length>0,'XLSX_PATH_INVALID');parts.pop();}else parts.push(part);}
    requireValue(parts.length>0,'XLSX_PATH_INVALID');return parts.join('/');
  }
  function relationshipSource(name){if(name==='_rels/.rels')return '';const m=name.match(/^(.*\/)?_rels\/([^/]+)\.rels$/);requireValue(m,'XLSX_PATH_INVALID');return (m[1]||'')+m[2];}
  function relationships(entries,docs){
    const result=new Map();for(const [name,doc]of docs)if(name.endsWith('.rels')){
      const root=doc.documentElement;requireValue(root.localName==='Relationships'&&root.namespaceURI===REL,'XLSX_XML_INVALID');const rels=new Map(),base=relationshipSource(name);
      for(const r of children(root,'Relationship',REL)){
        const id=r.getAttribute('Id'),type=r.getAttribute('Type'),target=r.getAttribute('Target'),mode=r.getAttribute('TargetMode');
        requireValue(id&&type&&target&&!rels.has(id),'XLSX_XML_INVALID');requireValue(!mode||mode==='Internal','XLSX_EXTERNAL_REFERENCE');requireValue(!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target),'XLSX_EXTERNAL_REFERENCE');
        requireValue(!/(?:vbaProject|externalLink|oleObject|attachedTemplate|connections|queryTable|activeX|ctrlProp|control)$/i.test(type),'XLSX_PART_UNSUPPORTED');
        const resolved=resolvePart(base,target);requireValue(entries.has(resolved),'XLSX_ZIP_INVALID');rels.set(id,{type,target:resolved});
      }
      result.set(base,rels);
    }
    return result;
  }
  function relKind(type,kind){return OFFICE.some(prefix=>type===prefix+kind);}
  function cleanText(value){
    value=value.replace(/_x([a-f0-9]{4})_/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
    requireValue(value.length<=LIMIT.text,'XLSX_LIMIT');requireValue(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value),'XLSX_CELL_INVALID');return value;
  }
  function richText(node,ns){
    let value='';for(const child of node.children){if(child.namespaceURI!==ns)continue;if(child.localName==='t')value+=child.textContent;else if(child.localName==='r'){const t=one(child,'t',ns);if(t)value+=t.textContent;}}
    return cleanText(value);
  }
  function sharedStrings(doc){
    if(!doc)return null;const root=doc.documentElement,ns=root.namespaceURI;requireValue(root.localName==='sst'&&MAIN.has(ns),'XLSX_XML_INVALID');const strings=children(root,'si',ns);requireValue(strings.length<=LIMIT.cells,'XLSX_LIMIT');return strings.map(si=>richText(si,ns));
  }
  function sheetRows(doc,shared){
    const root=doc.documentElement,ns=root.namespaceURI;requireValue(root.localName==='worksheet'&&MAIN.has(ns),'XLSX_XML_INVALID');const data=one(root,'sheetData',ns);if(!data)return {rows:[],errors:[]};
    const rows=[],errors=[];let lastRow=0,cells=0;
    for(const row of children(data,'row',ns)){
      const number=row.hasAttribute('r')?Number(row.getAttribute('r')):lastRow+1;requireValue(Number.isSafeInteger(number)&&number>lastRow,'XLSX_CELL_INVALID');requireValue(number<=LIMIT.rows,'XLSX_LIMIT');lastRow=number;
      const values=[],seen=new Set();let lastColumn=0;
      for(const cell of children(row,'c',ns)){
        cells++;requireValue(cells<=LIMIT.cells,'XLSX_LIMIT');let column=lastColumn+1;const ref=cell.getAttribute('r');
        if(ref){const m=ref.match(/^([A-Z]{1,3})([1-9]\d*)$/);requireValue(m&&Number(m[2])===number,'XLSX_CELL_INVALID');column=0;for(const ch of m[1])column=column*26+ch.charCodeAt(0)-64;}
        requireValue(column<=LIMIT.columns,'XLSX_LIMIT');requireValue(!seen.has(column),'XLSX_CELL_INVALID');seen.add(column);lastColumn=column;
        const v=one(cell,'v',ns),formula=one(cell,'f',ns),inline=one(cell,'is',ns),type=cell.getAttribute('t')||'n';let value='';
        if(formula&&(!v||!v.textContent.trim()))errors.push('XLSX_FORMULA_CACHE_MISSING');
        if(type==='inlineStr'){
          // Excel writers may serialize a present, empty string as <c t="inlineStr"/>.
          // Only an actually empty cell may omit <is>; cached values or text are not blanks.
          if(formula||v||!inline&&(cell.children.length||cell.textContent.trim()))errors.push('XLSX_CELL_INVALID');
          else if(inline)value=richText(inline,ns);
        }
        else if(type==='s'){
          const raw=v?.textContent||'';if(!/^\d+$/.test(raw)||!shared||!Number.isSafeInteger(Number(raw))||Number(raw)>=shared.length)errors.push('XLSX_CELL_INVALID');else value=shared[Number(raw)];
        }else if(type==='e')errors.push('XLSX_CELL_ERROR');
        else if(['n','b','str','d'].includes(type)){
          value=cleanText(v?.textContent||'');if(value&&type==='n'&&(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)||!Number.isFinite(Number(value))))errors.push('XLSX_CELL_INVALID');if(value&&type==='b'&&!/^[01]$/.test(value))errors.push('XLSX_CELL_INVALID');
        }else errors.push('XLSX_CELL_INVALID');
        values[column-1]=value;
      }
      rows.push(values);
    }
    return {rows,errors};
  }
  function header(value){return String(value||'').normalize('NFKC').replace(/\s+/g,'').replace(/\[[^\]]*\]|\([^)]*\)/g,'');}
  function tableHeaders(rows){return rows.flatMap((row,index)=>{
    const names=row.map(header);return [['部位','部位名'],['名称','部材名','名前'],['面積'],['貫流熱損失','熱貫流損失']].every(aliases=>names.some(n=>aliases.includes(n)))?[index]:[];
  });}
  async function read(file){
    requireValue(file&&typeof file.arrayBuffer==='function'&&typeof file.size==='number'&&file.size>0,'XLSX_FORMAT_UNSUPPORTED');requireValue(!file.name||/\.xlsx$/i.test(file.name),'XLSX_FORMAT_UNSUPPORTED');requireValue(file.size<=LIMIT.file,'XLSX_LIMIT');
    const bytes=new Uint8Array(await file.arrayBuffer());requireValue(bytes.length===file.size&&bytes.length<=LIMIT.file,'XLSX_LIMIT');const entries=await unzip(bytes),docs=new Map();
    for(const [name,data]of entries){requireValue(!/(?:^|\/)(?:vbaProject\.bin|externalLinks|embeddings|activeX|connections\.xml)(?:\/|$)/i.test(name),'XLSX_PART_UNSUPPORTED');if(/\.(?:xml|rels)$/i.test(name))docs.set(name,xml(data));}
    const content=docs.get('[Content_Types].xml');requireValue(content?.documentElement.localName==='Types'&&content.documentElement.namespaceURI==='http://schemas.openxmlformats.org/package/2006/content-types','XLSX_FORMAT_UNSUPPORTED');
    for(const item of content.documentElement.children)requireValue(!/(?:macro|vbaProject|activeX|oleObject|externalLink|binary)/i.test(item.getAttribute('ContentType')||''),'XLSX_PART_UNSUPPORTED');
    const rels=relationships(entries,docs),offices=[...(rels.get('')?.values()||[])].filter(r=>relKind(r.type,'officeDocument'));requireValue(offices.length===1,'XLSX_FORMAT_UNSUPPORTED');
    const workbook=docs.get(offices[0].target),root=workbook?.documentElement,ns=root?.namespaceURI;requireValue(root?.localName==='workbook'&&MAIN.has(ns),'XLSX_FORMAT_UNSUPPORTED');
    const bookRels=rels.get(offices[0].target);requireValue(bookRels,'XLSX_FORMAT_UNSUPPORTED');const stringRels=[...bookRels.values()].filter(r=>relKind(r.type,'sharedStrings'));requireValue(stringRels.length<=1,'XLSX_XML_INVALID');const shared=sharedStrings(stringRels.length?docs.get(stringRels[0].target):null);
    const sheets=one(root,'sheets',ns);requireValue(sheets,'XLSX_TABLE_MISSING');const candidates=[],sheetTargets=new Set();
    for(const sheet of children(sheets,'sheet',ns)){
      const id=OFFICE.map(uri=>sheet.getAttributeNS(uri.slice(0,-1),'id')).find(Boolean),relation=bookRels.get(id);requireValue(relation,'XLSX_ZIP_INVALID');
      if(!relKind(relation.type,'worksheet'))continue;requireValue(!sheetTargets.has(relation.target),'XLSX_XML_INVALID');sheetTargets.add(relation.target);const doc=docs.get(relation.target);requireValue(doc,'XLSX_XML_INVALID');
      const parsed=sheetRows(doc,shared),headers=tableHeaders(parsed.rows);if(headers.length)candidates.push({parsed,headers});
    }
    requireValue(candidates.length>0,'XLSX_TABLE_MISSING');requireValue(candidates.length===1,'XLSX_TABLE_AMBIGUOUS');const chosen=candidates[0];requireValue(!chosen.parsed.errors.length,chosen.parsed.errors[0]);
    const firstHeader=JSON.stringify(chosen.parsed.rows[chosen.headers[0]].map(header));
    requireValue(chosen.headers.every(i=>JSON.stringify(chosen.parsed.rows[i].map(header))===firstHeader),'XLSX_TABLE_AMBIGUOUS');
    // Repeated headers within the selected sheet remain in the CSV for existing row diagnostics.
    const rows=chosen.parsed.rows.slice(chosen.headers[0]),width=Math.max(...rows.map(row=>row.length));let length=0;
    return rows.map(row=>Array.from({length:width},(_,i)=>{const value=String(row[i]??''),quoted=/[",\r\n]/.test(value)?'"'+value.replace(/"/g,'""')+'"':value;length+=quoted.length+1;requireValue(length<=LIMIT.csv,'XLSX_LIMIT');return quoted;}).join(',')).join('\r\n')+'\r\n';
  }
  global.boundaryReadXlsxCsv=async function(file){try{return await read(file);}catch(error){if(error&&Object.hasOwn(MESSAGES,error.code))throw error;fail('XLSX_READ_FAILED');}};
})(typeof window==='undefined'?globalThis:window);
