// AI 防詐盾牌 - 機器人語音助手
(function(){
  function speak(text){
    try {
      if (!('speechSynthesis' in window)) return;
      var utter = new SpeechSynthesisUtterance(text || '看到可疑網頁，先停一下，不要輸入資料。');
      utter.lang = 'zh-TW';
      utter.rate = 0.9;
      utter.pitch = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch(e) {}
  }
  window.AIShieldVoice = { speak: speak };
  document.addEventListener('DOMContentLoaded', function(){
    var bubble = document.getElementById('voice-bubble') || document.querySelector('.speech-bubble');
    var mascot = document.getElementById('main-mascot');
    var text = '這個網站可能有問題。先不要輸入資料，不要匯款，請問家人或撥打一六五。';
    if (bubble) bubble.addEventListener('click', function(){ speak(text); });
    if (mascot) mascot.addEventListener('click', function(){ speak(text); });
  });
})();
