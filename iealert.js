/*
 * IE Alert! jQuery plugin
 * version 1
 * author: David Nemes http://nmsdvid.com
 * http://nmsdvid.com/iealert/
 */

(function($){
$("#goon").live("click", function(){
		$("#ie-alert-overlay").hide();	
		$("#ie-alert-panel").hide();						  
});
function initialize($obj, support, title, text){

		var panel = "<span>"+ title +"</span>"
				  + "<p> "+ text +"</p>"
			      + "<div class='browser'>"
			      + "<ul>"
			      + "<li><a class='chrome' href='https://www.google.com/chrome/' target='_blank'></a></li>"
			      + "<li><a class='firefox' href='http://www.mozilla.org/en-US/firefox/new/' target='_blank'></a></li>"
			      + "<li><a class='ie9' href='http://windows.microsoft.com/en-US/internet-explorer/downloads/ie/' target='_blank'></a></li>"
			      + "<li><a class='safari' href='http://www.apple.com/safari/download/' target='_blank'></a></li>"
			      + "<li><a class='opera' href='http://www.opera.com/download/' target='_blank'></a></li>"
			      + "<ul>"
			      + "</div>"; 

		var overlay = $("<div id='ie-alert-overlay'></div>");
		var iepanel = $("<div id='ie-alert-panel'>"+ panel +"</div>");

		var docHeight = $(document).height();

		overlay.css("height", docHeight + "px");



			     
		
		if (support === "ie8") { 			// shows the alert msg in IE8, IE7, IE6
		
			if ($.browser.msie  && parseInt($.browser.version, 10) < 9) {
				
				$obj.prepend(iepanel);
				$obj.prepend(overlay);
				
			}

			if ($.browser.msie  && parseInt($.browser.version, 10) === 6) {

				
				$("#ie-alert-panel").css("background-position","-626px -116px");
				$obj.css("margin","0");
  
			}
			
			
		} else if (support === "ie7") { 	// shows the alert msg in IE7, IE6
			
			if ($.browser.msie  && parseInt($.browser.version, 10) < 8) {
				
				$obj.prepend(iepanel);
				$obj.prepend(overlay);
			}
			
			if ($.browser.msie  && parseInt($.browser.version, 10) === 6) {
				
				$("#ie-alert-panel").css("background-position","-626px -116px");
				$obj.css("margin","0");
  
			}
			
		} else if (support === "ie6") { 	// shows the alert msg only in IE6
			
			if ($.browser.msie  && parseInt($.browser.version, 10) < 7) {
				
				$obj.prepend(iepanel);
				$obj.prepend(overlay);
				
  				$("#ie-alert-panel").css("background-position","-626px -116px");
				$obj.css("margin","0");
				
			}
		}

}; //end initialize function


	$.fn.iealert = function(options){
		var defaults = { 
			support: "ie8",  // ie8 (ie6,ie7,ie8), ie7 (ie6,ie7), ie6 (ie6)
			title: "你知道你的Internet Explorer已经过时了吗?", // title text
			text: "为了得到本网站最好的体验效果,本人建议您升级到最新版本的Internet Explorer或选择另一个web浏览器.推荐使用下面的浏览器.<br /><br /><h1 id='goon' style='font-size:20px;cursor:pointer;'>>>>放弃最好体验效果，继续访问</h1>"
		};
		
		
		var option = $.extend(defaults, options);

		
		

			return this.each(function(){
				if ( $.browser.msie ) {
					var $this = $(this);  
					initialize($this, option.support, option.title, option.text);
				} //if ie	
			});		       
	
	};
})(jQuery);
