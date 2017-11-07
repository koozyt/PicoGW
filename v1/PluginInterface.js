// Plugin interface that is passed to each plugin constructor
"use strict";

var fs = require('fs');
var path = require('path');
let SingleFileLocalStorage = require('../MyLocalStorage.js').SingleFileLocalStorage ;

var globals = {} ;	// VERSION, admin, PubSub
exports.PluginInterface = class {
	constructor ( _globals, prefix, pluginPath ) {
		globals = _globals ;
	    this.prefix = prefix ;
        this.pluginPath = pluginPath;
	    this.log = (msg) => { console.log(`${this.prefix} plugin> ${msg}`); };

	    this.localStorage = new SingleFileLocalStorage(this.getpath()+'localstorage.json') ;
	    this.localSettings = new SingleFileLocalStorage(this.getpath()+'settings.json') ;

	    //These can return Promise, but never call reject().
		this.getSettingsSchema = ()=>{ try {
   			return JSON.parse(fs.readFileSync(this.getpath()+'settings_schema.json').toString()) ;
   		} catch(e){} } ;
		this.getSettings = ()=>{ try {
   			return JSON.parse(fs.readFileSync(this.getpath()+'settings.json').toString()) ;
   		} catch(e){} } ;

   		
	    this.onSettingsUpdated = newsettings=>{} ;
   	}
	setOnGetSettingsSchemaCallback(callback){ this.getSettingsSchema = callback ; }
	setOnGetSettingsCallback(callback){ this.getSettings = callback ; }
	setOnSettingsUpdatedCallback(callback){ this.onSettingsUpdated = callback ; }

	publish ( topicname, args) {
		var path ;
		if( topicname==null || topicname==='')
			path = `/${globals.VERSION}/${this.prefix}` ;
		else {
			if( topicname.slice(-1)=='/') topicname=topicname.slice(0,-1) ;
			path = `/${globals.VERSION}/${this.prefix}/${topicname}` ;
		}

		var re = {method:'PUB'} ;
		//var path = `/${globals.VERSION}/${this.prefix}/${devid}/${topicname}` ;
		re[path] = args ;
		globals.PubSub.pub(path,re /*{method:'PUB',path:path,args:args}*/) ;
	}

	// Returns promise
	getNetIDFromIPv4Address (ipv4addr) {
		if( this.prefix == 'admin')
			return Promise.reject('Cannot call getNetIDFromIPv4Address from admin plugin') ;
		return globals.admin.getNetIDFromIPv4Address_Forward(ipv4addr) ;
	}

	// callbacks_obj can contain the following four members
	// onNewIDFoundCallback			: function(newid,newip) ;
	// onIPAddressLostCallback		: function(id,lostip) ;
	// onIPAddressRecoveredCallback	: function(id,recoveredip) ;
	// onIPAddressChangedCallback	: function(id,oldip,newip) ;
	setNetIDCallbacks (callbacks_obj) {
		globals.admin.setNetIDCallbacks_Forward(this.prefix , callbacks_obj) ;
	}


	getPubKey(){ return globals.getPubKey() ; }
	encrypt(str){ return globals.encrypt(str) ; }
	decrypt(str){ return globals.decrypt(str) ; }
	// handlerName = 'SettingsUpdated', etc...
	on(handlerName,handler_body){ this['on'+handlerName] = handler_body ; }
	off(handlerName){ delete this['on'+handlerName] ; this['on'+handlerName] = undefined ;}
	// Get plugin home dir
	getpath(){ return path.join(this.pluginPath, '/'); }
	getprefix (){ return this.prefix; }
} ;