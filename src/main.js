/**
 * Wrapper for headtrackr library
 *
 * Usage:
 *	var htracker = new headtrackr.Tracker(); 
 *	htracker.init(canvasInput); 
 *	htracker.start(); 
 *
 * Optional parameters can be passed to Tracker like this:
 *	new headtrackr.Tracker({ ui : false, altVideo : "somevideo.ogv" });
 *
 * Optional parameters:
 *	ui {boolean} : whether to create messageoverlay with messages like "found face" (default is true)
 *	altVideo {object} : urls to any alternative videos, if camera is not found or not supported
 *		the format is : {'ogv' : 'somevideo.ogv', 'mp4' : 'somevideo.mp4', 'webm' : 'somevideo.webm'}
 *	smoothing {boolean} : whether to use smoothing (default is true)
 *	debug {canvas} : pass along a canvas to paint output of facedetection, for debugging
 *	detectionInterval {number} : time we wait before doing a new facedetection (default is 20 ms)
 *	retryDetection {boolean} : whether to start facedetection again if we lose track of face (default is true)
 *	fov {number} : horizontal field of view of used camera in degrees (default is to estimate this)
 *	cameraOffset {number} : distance from camera to center of screen, used to offset position of head (default is 11.5)
 *	calcAngles {boolean} : whether to calculate angles when doing facetracking (default is false)
 *	headPosition {boolean} : whether to calculate headposition (default is true)
 *
 * @author auduno / github.com/auduno
 */

var headtrackr = {};
headtrackr.rev = 2;

/**
 * @constructor
 */
headtrackr.Tracker = function(params) {
	if (!params) params = {};
	
	if (params.smoothing === undefined) params.smoothing = true;
	if (params.retryDetection === undefined) params.retryDetection = true;
	if (params.ui === undefined) params.ui = true;
	if (params.debug === undefined) {
		params.debug = false;
	} else {
		if (params.debug.tagName != 'CANVAS') {
			params.debug = false;
		} else {
			var debugContext = params.debug.getContext('2d');
		}
	}
	if (params.detectionInterval === undefined) params.detectionInterval = 20;
	if (params.cameraOffset === undefined) params.cameraOffset = 11.5;
	if (params.calcAngles === undefined) params.calcAngles = false;
	if (params.headPosition === undefined) params.headPosition = true;
	
	var ui, smoother, facetracker, headposition, canvasContext, detector;
	var detectionTimer;
	var fov = 0;
	var initialized = true;
	var run = false;
	var faceFound = false;
	var firstRun = true;
	var headDiagonal = [];
	
	this.status = "";
	
	var statusEvent = document.createEvent("Event");
	statusEvent.initEvent("headtrackrStatus", true, true);
	
	var headtrackerStatus = function(message) {
		statusEvent.status = message;
		document.dispatchEvent(statusEvent);
		this.status = message;
	}.bind(this);
	
	this.init = function(canvas) {
		headtrackerStatus("getUserMedia");
		
		canvasElement = canvas;
		canvasContext = canvas.getContext("2d");
		
		// create ui if needed
		if (params.ui) {
			ui = new headtrackr.Ui();
		}
		
		// create smoother if enabled
		smoother = new headtrackr.Smoother(0.35, params.detectionInterval+15);
		
		this.initialized = true;
	}
	
	track = function() {
		// if facetracking hasn't started, initialize facetrackr
		if (facetracker === undefined) {
			facetracker = new headtrackr.facetrackr.Tracker({debug : params.debug, calcAngles : params.calcAngles});
			facetracker.init(canvasElement);
		}
		
		// track face
		facetracker.track()
		var faceObj = facetracker.getTrackingObject({debug : params.debug});
		
		if (faceObj.detection == "WB") headtrackerStatus("whitebalance");
		if (firstRun && faceObj.detection == "VJ") headtrackerStatus("detecting");
		
		// check if we have a detection first
		if (!(faceObj.confidence == 0)) {
			if (faceObj.detection == "VJ") {
				if (detectionTimer === undefined) {
					// start timing
					detectionTimer = (new Date).getTime();
				}
				if (((new Date).getTime() - detectionTimer) > 5000) {
					headtrackerStatus("hints");
				}
				
				var x = (faceObj.x + faceObj.width/2); //midpoint
				var y = (faceObj.y + faceObj.height/2); //midpoint
				
				if (params.debug) {
					// draw detected face on debuggercanvas
					debugContext.strokeStyle = "#0000CC";
					debugContext.strokeRect(faceObj.x, faceObj.y, faceObj.width, faceObj.height);
				}
			}
			if (faceObj.detection == "CS") {
				var x = faceObj.x; //midpoint
				var y = faceObj.y; //midpoint
				
				if (detectionTimer !== undefined) detectionTimer = undefined;
				
				if (params.debug) {
					// draw tracked face on debuggercanvas
					debugContext.translate(faceObj.x, faceObj.y)
					debugContext.rotate(faceObj.angle-(Math.PI/2));
					debugContext.strokeStyle = "#00CC00";
					debugContext.strokeRect((-(faceObj.width/2)) >> 0, (-(faceObj.height/2)) >> 0, faceObj.width, faceObj.height);
					debugContext.rotate((Math.PI/2)-faceObj.angle);
					debugContext.translate(-faceObj.x, -faceObj.y);
				}
				
				this.status = 'tracking';
				
				//check if we've lost tracking of face
				if (faceObj.width == 0 || faceObj.height == 0) {
					if (params.retryDetection) {
						// retry facedetection
						headtrackerStatus("redetecting");
						
						facetracker = new headtrackr.facetrackr.Tracker({whitebalancing : false, debug: params.debug, calcAngles : params.calcAngles});
						facetracker.init(canvasElement);
						faceFound = false;
						headposition = undefined;
					} else {
						headtrackerStatus("lost");
						this.stop();
					}
				} else {
					if (!faceFound) {
						headtrackerStatus("found");
						faceFound = true;
					}
					
					if (params.smoothing) {
						// smooth values
						if (!smoother.initialized) {
							smoother.init(faceObj);
						}
						faceObj = smoother.smooth(faceObj);
					}
					
					// get headposition
					if (headposition === undefined && params.headPosition) {
						// wait until headdiagonal is stable before initializing headposition
						var stable = false;
						
						// calculate headdiagonal
						var headdiag = Math.sqrt(faceObj.width*faceObj.width + faceObj.height*faceObj.height);
						
						if (headDiagonal.length < 6) {
							headDiagonal.push(headdiag);
						} else {
							headDiagonal.splice(0,1);
							headDiagonal.push(headdiag);
							if ((Math.max.apply(null, headDiagonal) - Math.min.apply(null, headDiagonal)) < 5) {
								stable = true;
							}
						}
						
						if (stable) {
							if (firstRun) {
								if (params.fov === undefined) {
									headposition = new headtrackr.headposition.Tracker(faceObj, canvasElement.width, canvasElement.height, {distance_from_camera_to_screen : params.cameraOffset});
								} else {
									headposition = new headtrackr.headposition.Tracker(faceObj, canvasElement.width, canvasElement.height, {fov : params.fov, distance_from_camera_to_screen : params.cameraOffset});
								}
								fov = headposition.getFOV();
								firstRun = false;
							} else {
								headposition = new headtrackr.headposition.Tracker(faceObj, canvasElement.width, canvasElement.height, {fov : fov, distance_from_camera_to_screen : params.cameraOffset});
							}
							headposition.track(faceObj);
						}
					} else if (params.headPosition) {
						headposition.track(faceObj);
					}
				}
			}
		}
	 
		if (run) {
			detector = window.setTimeout(track, params.detectionInterval);
		}
	}.bind(this);
	
	var starter = function() {
		// does some safety checks before starting
		// sometimes canvasContext is not available yet, so try and catch if it's not there...
		try {
			var canvasContent = headtrackr.getWhitebalance(canvasElement);

			if (canvasContent > 0) {
				run = true;
				track();
			} else {
				window.setTimeout(starter, 100);
			}
		} catch (err) {
			window.setTimeout(starter, 100);
		}
	}
	
	this.start = function() {
		// check if initialized
		if (!this.initialized) return false;
		
		starter();
		
		return true;
	}
	
	this.stop = function() {
		window.clearTimeout(detector);
		run = false;
		headtrackerStatus("stopped");
		facetracker = undefined;
		faceFound = false;
		
		return true;
	}
	
	this.getFOV = function() {
		return fov;
	}
};

// bind shim
// from https://developer.mozilla.org/en/JavaScript/Reference/Global_Objects/Function/bind

if (!Function.prototype.bind) {
	Function.prototype.bind = function (oThis) {
		if (typeof this !== "function") {
			// closest thing possible to the ECMAScript 5 internal IsCallable function
			throw new TypeError("Function.prototype.bind - what is trying to be bound is not callable");
		}
	
		var aArgs = Array.prototype.slice.call(arguments, 1),
				fToBind = this,
				fNOP = function () {},
				fBound = function () {
					return fToBind.apply(this instanceof fNOP ? this : oThis || window,
							aArgs.concat(Array.prototype.slice.call(arguments)));
				};
	
		fNOP.prototype = this.prototype;
		fBound.prototype = new fNOP();
	
		return fBound;
	};
}
