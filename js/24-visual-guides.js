/* Local vector diagrams explain the action at each stage, without adding input steps. */
(function(){
  'use strict';
  const guides={
    data:{title:'資料の読込から反映まで',asset:'data',alt:'3DS・CSV・PDFを同じ物件の資料として読み込み、取得結果を確認して入力へ反映する順番',steps:['同じ物件の3DS・CSV／Excel・PDFを選びます。','取得できた部屋・仕様・数値と、要確認の項目を見ます。','「確認して入力へ反映」を押すと、各工程で使えるようになります。'],note:'ファイルを選んだだけでは、入力への反映は完了しません。'},
    rooms:{title:'部屋の確認・結合・吹き抜け',asset:'rooms',alt:'別々の区画を結合する平面図と、上下階の床と天井を抜いてつなぐ断面図',steps:['階を切り替え、図面の部屋名と位置を照合します。','分かれた同じ部屋はShift＋クリックで複数選択し、「結合する」を押します。','階段や吹き抜けは上下階の床・天井の開口を指定し、形状を確認します。'],note:'部屋名の割当と、床・天井の開口は別の操作です。3DSにない内壁は図面から自動で作られません。'},
    weather:{title:'いつ・どこの・何℃を調べるか',asset:'weather',alt:'場所、解析する日時、目標室温の3条件を建物へ結びつける図',steps:['敷地の場所と、解析する日付・時刻を決めます。','最高・最低気温など、今回の外気の条件を確認します。','目標室温を設定します。エアコンの負荷と吹出温度にも使われます。'],note:'表示中の初期値は、今回の建物や解析日について確認された値とは限りません。'},
    thermal:{title:'外壁・屋根・天井の違い',asset:'thermal',alt:'天井断熱は最上階の天井、屋根断熱は屋根の斜面に断熱材を置く2つの断面図',steps:['外壁は、資料の仕様と対応する面を確認します。','屋根の斜面に断熱材がある場合は「屋根断熱」を選びます。','部屋の天井に断熱材がある場合は「天井断熱」を選び、小屋裏の条件も確認します。'],note:'図の赤茶色が断熱材の位置です。屋根と天井のU値は別の値として扱います。'},
    gains:{title:'部屋に入る熱と、水蒸気の考え方',asset:'gains',alt:'窓の日射、人、家電から部屋に熱が入り、人などから水蒸気が発生する。熱Wと発湿g毎時は別々にFDへ渡す図',steps:['人数と床面積を確認します。人・家電の原単位は、下の「使用中の値」で確認できます。','窓のある部屋は、窓の面積・向き・η0から日射も計算します。','発熱量はW、発湿量はg/hで別々に集計します。入力は自動で計算に使われます。'],note:'家電の使い方が異なる場合は詳細設定で変更します。入力した人数は、その時刻に部屋にいる人数です。'},
    ac:{title:'負荷・風量・吹出温度の関係',asset:'ac',alt:'部屋に入る熱をエアコンで処理し、吹出しと吸込みの空気を循環させる図',steps:['部屋の発熱と、外皮・換気から入る熱を確認します。','実際に使うエアコンの台数と風量を設定します。','概算した吹出温度を確認します。極端な温度なら、負荷と風量の入力を見直します。'],note:'図は空気の循環の説明です。機器能力の確認と、CFDへ渡す境界条件の設定を区別してください。'},
    fd:{title:'FDへ渡す順番とファイルの置き場所',asset:'fd',alt:'DownloadsのobjParam.csvを、架空の解析プロジェクトの.fdpと同じフォルダへ移動する配置図',steps:['色分けした形状をFDへ取り込み、FDから色対応CSVを出します。','Toolで色対応CSVを読み込み、条件を確認してobjParam.csvを出します。','objParam.csvを対象の.fdpと同じフォルダへ移動し、FDで反映します。'],note:'FD反映用は固定名objParam.csvです。(1)付きや二重拡張子を直してください。ブラウザで読み込む色対応CSVの名前には、この固定名の制約はありません。'},
    solver:{title:'FDで確認してから解析する',asset:'solver',alt:'モデルと境界条件を照合し、解析領域と計算設定を確認してから解析を開始する図',steps:['壁・窓・発生エリア・開口・空調に、意図した条件が付いているか確認します。','解析領域、メッシュ、初期条件などをFDで確認します。','FDで解析を開始します。Toolの工程を開くだけでは解析完了になりません。'],note:'条件CSVの出力後にモデルや色を変えた場合は、対応するCSVを取り直してください。'}
  };
  const installed=new Map();let previousMode='';
  const epData={title:'IDFと計算結果の読込',asset:'data-ep',alt:'IDFとSQLを読み込み、同じモデルの計算結果であることを確認して各設定に使う順番',steps:['建物のIDFと、そのモデルで計算したSQLを選びます。','部屋・窓・性能と、計算した日時の結果を確認します。','取得した値を各工程で確認します。PDF／CSVの反映操作とは異なります。'],note:'SQLが別のモデルや計算条件の結果でないことを確認してください。'};
  window.boundaryInstallVisualGuides=function(panels){
    for(const [key,g]of Object.entries(guides)){
      const panel=panels.get(key);if(!panel)continue;
      const details=document.createElement('details');details.id='visualGuide-'+key;details.className='task-visual-guide';details.dataset.gainsDisclosure='';
      const summary=document.createElement('summary');summary.textContent='図で確認：'+g.title;
      const body=document.createElement('div');body.className='task-visual-body';
      const img=document.createElement('img');img.src='assets/guides/'+g.asset+'.svg';img.alt=g.alt;img.width=480;img.height=210;img.decoding='async';
      const text=document.createElement('div'),list=document.createElement('ol');for(const label of g.steps){const li=document.createElement('li');li.textContent=label;list.append(li);}
      const note=document.createElement('p');note.textContent=g.note;note.className='task-visual-note';text.append(list,note);body.append(img,text);details.append(summary,body);
      const tabs=panel.querySelector(':scope > .journey-part-tabs');if(tabs)tabs.after(details);else panel.prepend(details);
      installed.set(key,{details,summary,img,list,note});
    }
  };
  window.boundaryRefreshVisualGuides=function(mode){
    if(previousMode===mode)return;previousMode=mode;
    for(const [key,el]of installed){
      let g=key==='data'&&mode==='energyplus'?epData:guides[key];
      el.details.hidden=key==='rooms'&&mode==='energyplus';
      if(key==='thermal'&&mode!=='architrend')g={...g,steps:['外壁は、資料にある外壁のU値を確認して入力します。','図で断熱材の位置を確認し、資料の屋根と天井の値を区別します。','屋根面に使うU値を設定します。天井の値を屋根へ移すことは避けます。']};
      el.summary.textContent='図で確認：'+g.title;el.img.src='assets/guides/'+g.asset+'.svg';el.img.alt=g.alt;
      [...el.list.children].forEach((li,i)=>li.textContent=g.steps[i]);el.note.textContent=g.note;
    }
  };
})();
