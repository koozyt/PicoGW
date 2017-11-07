"use strict";

const VERSION = 'v1';
const CALL_TIMEOUT = 60*1000 ;

var fs = require('fs');
var path = require('path');

var PluginInterface = require('./PluginInterface.js').PluginInterface ;

var log = console.log ;
var admin ;

var globals ;
var Plugins = {} ;

exports.init = function(_globals /*,clientFactory*/){
	globals = _globals ;
	return new Promise( function(ac,rj){
        loadPlugins().then(plugin_paths => {
            log('Plugins registeration started.') ;
            // Admin plugin should be initialized first
            registerplugin(plugin_paths, 'admin').then(() => {
                ac('All plugins initialization process is ended.');
            });
        });
	}) ;
} ;

async function loadPlugins() {
    const legacyPluginPaths = await searchLegacyPlugins();
    const npmPluginPaths = await searchNpmPlugins();
    return Object.assign(legacyPluginPaths, npmPluginPaths);
}

function searchLegacyPlugins() {
    return new Promise((ac,rj) => {
	    // Scan plugins
	    const PLUGINS_FOLDER = path.join('./', VERSION, '/plugins/') ;
	    try {
		    fs.statSync( PLUGINS_FOLDER ) ;
		    fs.readdir( PLUGINS_FOLDER, (err, files) => {
			    if (err){ rj('No plugin folder found.'); return; }

			    var plugin_paths = {} ;
			    files.filter(dirname => {
				    var fo = fs.lstatSync(PLUGINS_FOLDER + dirname) ;
				    return fo.isDirectory() || fo.isSymbolicLink();
			    }).forEach(dirname => {
				    plugin_paths[dirname] = path.join(PLUGINS_FOLDER, dirname, 'index.js');
		   	    }) ;
                ac(plugin_paths);
		    }) ;
	    } catch(e){
		    rj('No plugins exists.') ;
	    }
    });
}

function searchNpmPlugins() {
    return new Promise((resolve, reject) => {
        // This list npm code is TOO slow, so comment this code and read node_modules direcotry directly...
        //npm.load({}, (err) => {
        //    if (err) {
        //        console.error(err);
        //        reject(err);
        //        return;
        //    }
        //    npm.commands.ls([], true, (err, data, packages) => {
        //        let npms = Object.keys(packages.dependencies);
        //        npms = npms.filter((name) => {
        //            return name.startsWith('picogw-plugin-');
        //        });
        //        resolve(npms);
        //    });
        //})

        //const rootpath = path.dirname(path.dirname(__filename));
        const rootpath = '.';
        fs.readdir(path.join(rootpath, 'node_modules'), (err, files) => {
            if (err) {
                console.error(err);
                reject(err);
                return;
            }
            const paths = {};
            files = files.filter((name) => {
                return name.startsWith('picogw-plugin-');
            }).forEach((name) => {
                paths[name] = path.join(rootpath, 'node_modules', name);
            });
            resolve(paths);
        });
    });
}

async function registerplugin(plugin_paths, plugin_name){
    const plugin_path = plugin_paths[plugin_name];
    delete plugin_paths[plugin_name];
	var pc = new PluginInterface(
		{VERSION:VERSION,admin:admin,PubSub:globals.PubSub}
		,plugin_name, plugin_path) ;
	var exportmethods = {} ;
	[ 'publish','log','on','off','getNetIDFromIPv4Address','setNetIDCallbacks'
		,'getSettingsSchema','getSettings'
		,'setOnGetSettingsSchemaCallback','setOnGetSettingsCallback','setOnSettingsUpdatedCallback'
		,'getpath','getprefix']
		.forEach(methodname => {
		exportmethods[methodname] = function(){
			return pc[methodname].apply(pc,arguments);
		} ;
	}) ;
	exportmethods.localStorage = pc.localStorage ;
	exportmethods.localSettings = pc.localSettings ;

	try {
		var pobj = require(path.join('..', plugin_path)) ;
		// Plugin init must return procedure call callback function.
        const initPlugin = async function (pobj) {
	        return pobj.init(exportmethods);
        }
        return initPlugin(pobj, exportmethods).then( p => {
			pc.procCallback = p ;
			Plugins[plugin_name] = pc ;
			if( plugin_name === 'admin' )	admin = pobj ;
			log(plugin_name+' plugin initiaized') ;
		}).catch(e=>{
			log(plugin_name+' plugin could not be initiaized') ;
		}).then(() => {
            const names = Object.keys(plugin_paths);
            if( names.length == 0 ){return;}
            return registerplugin(plugin_paths, names[0]) ;
        });

	} catch (e){
        log('Error in initializing '+plugin_name+' plugin: '+JSON.stringify(e));
        console.log(e);
    }
}


exports.callproc = function(params){
	var method = params.method ;
	var procedure = params.path ;
	var args = params.args ;
	if(args==undefined) args={} ;

	return new Promise( (ac,rj)=>{
		try {
			if( procedure.length == 0 ){ // access for '/v1/' => plugin list
				let ps = {} ;
				let prms = [] , prms_prfx = [] ;
				for( let prfx in Plugins ){
					let plugin = Plugins[prfx] ;
					ps[prfx] = {
						path : plugin.getpath()
						, callable: (typeof plugin.procCallback == 'function')
					} ;
					if( args.option === 'true'){
						prms.push(plugin.getSettingsSchema()) ;
						prms_prfx.push(prfx) ;
						prms.push(plugin.getSettings()) ;
						prms_prfx.push(prfx) ;
						ps[prfx].option = {
							leaf:false
							//,doc:{short:'Plugin'}
							//,settings_schema : .. , settings : .. (set later)
						} ;
					}
				}
				if( prms.length == 0 )	ac(ps) ;
				else Promise.all(prms).then(re=>{
					for( let pi=0;pi<re.length;++pi ){
						if( pi%2 == 0 )	ps[prms_prfx[pi]].option.settings_schema = re[pi] ;
						else			ps[prms_prfx[pi]].option.settings = re[pi] ;
					}
					ac(ps) ;
				}).catch(rj) ;
				return ;
			}
			let terms = procedure.split('/') ;
			while(terms[terms.length-1]=='') terms.pop() ;
			let pprefix = terms[0] , ppath = terms.slice(1).join('/');//pdevid = terms[1] , ppropname = terms.slice(2).join('/') ;
			//var pprefix = terms[0] , pdevid = terms[1] , ppropname = terms.slice(2).join('/') ;

			// Update settings.json
			if( method === 'POST' && Plugins[pprefix] != undefined
				&& ppath.indexOf('settings')==0 ){
//				&& pdevid === 'settings'
//				&& (ppropname == undefined || ppropname == '') ){

				Promise.all([Plugins[pprefix].onSettingsUpdated(args)]).then(re=>{
					fs.writeFile( Plugins[pprefix].getpath()+'settings.json'
						, JSON.stringify(args,null,"\t") , function(err){
							if( err ) rj({error:err}) ;
							else ac({success:true,message:'settings.json was successfully updated.',result:re[0]}) ;
						} ) ;
				}).catch(e=>{
					rj({error:e}) ;
				}) ;
				return ;
			}


			let proccallback = Plugins[pprefix].procCallback ;
			if( typeof proccallback == 'function'){

				let bReplied = false ;
				Promise.all([proccallback(method.toUpperCase(),ppath /*pdevid,ppropname*/,args)])
					.then(re=>{ if( !bReplied ){ bReplied = true ; ac(re[0]); } })
					.catch(re=>{ if( !bReplied ){ bReplied = true ; rj(re); } }) ;
				setTimeout(()=>{if( !bReplied ){ bReplied = true ; rj({error:`GET request timeout:${ppath}`})}}
					,CALL_TIMEOUT) ;
			} else rj({error:'Procedure callback is not defined for the plugin '+pprefix}) ;
		} catch(e){
			rj({error:'Invalidly formatted procedure: ' + procedure});
		} ;
	}) ;
} ;