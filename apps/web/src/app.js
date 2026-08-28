(function () {
  const plans = {
    balanced: { title: '均衡方案', text: '优先提升较弱一队的推进；成员分配和输出仅为 UI 占位。', members: [['水母队', '等待成员快照'], ['刺猬队', '等待成员快照']] },
    robust: { title: '稳健方案', text: '优先满足坦克、治疗、光环与减益覆盖，再比较推进。', members: [['水母队', 'Coverage 未校准'], ['刺猬队', 'Coverage 未校准']] },
    push: { title: '冲层方案', text: '在覆盖约束满足后优先峰值推进；死亡和空蓝风险会明确标注。', members: [['水母队', '模拟器未接入'], ['刺猬队', '模拟器未接入']] }
  };
  const coverages = ['坦克威胁', '治疗', '关键光环', '关键 Debuff', '空蓝风险'];
  function renderCoverage(id) { document.querySelector(id).innerHTML = coverages.map((name) => `<li><span>${name}</span><strong class="unknown">unknown</strong></li>`).join(''); }
  function renderPlan(key) { const p = plans[key]; const content = document.getElementById('plan-content'); const fragment = document.getElementById('plan-template').content.cloneNode(true); fragment.querySelector('h2').textContent = p.title; fragment.querySelector('p').textContent = p.text; fragment.querySelector('.roster').innerHTML = p.members.map(([team, state]) => `<div><strong>${team}</strong><small class="placeholder">${state}</small></div>`).join(''); content.replaceChildren(fragment); }
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => { const selected = item === tab; item.classList.toggle('active', selected); item.setAttribute('aria-selected', String(selected)); }); renderPlan(tab.dataset.plan); }));
  document.getElementById('import-members').addEventListener('click', () => document.getElementById('member-file').click());
  document.getElementById('member-file').addEventListener('change', (event) => { const file = event.target.files[0]; document.getElementById('import-status').textContent = file ? `已选择 ${file.name}；解析与来源校验将在 Adapter 接入后启用。` : '未导入。支持未来接入公会助手或本地 JSON 导出。'; });
  renderCoverage('#jellyfish-coverage'); renderCoverage('#hedgehog-coverage'); renderPlan('balanced');
}());
