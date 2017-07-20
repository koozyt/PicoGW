let pluginInterface ;
let log = console.log ;
let localStorage ;
let ipv4 = require('./ipv4.js');
let cryptico = require('cryptico');
let sudo = require('sudo');
var fs = require('fs');
const exec = require('child_process').exec;

const RSA_BITS = 1024 ;
let rsaKey , pubKey ;

exports.init = function(pi){
	pluginInterface = pi ;
	log = pluginInterface.log ;
	localStorage = pluginInterface.localStorage ;
	
	ipv4.setNetCallbackFunctions(
		function(newid,newip){
			for( let plugin_name in netIDCallbacks )
				if( netIDCallbacks[plugin_name].onNewIDFoundCallback != undefined )
					netIDCallbacks[plugin_name].onNewIDFoundCallback(newid,newip) ;
		}
		,function(id,lostip){
			for( let plugin_name in netIDCallbacks )
				if( netIDCallbacks[plugin_name].onIPAddressLostCallback != undefined )
					netIDCallbacks[plugin_name].onIPAddressLostCallback(id,lostip) ;
		}
		,function(id,recoveredip){
			for( let plugin_name in netIDCallbacks )
				if( netIDCallbacks[plugin_name].onIPAddressRecoveredCallback != undefined )
					netIDCallbacks[plugin_name].onIPAddressRecoveredCallback(id,recoveredip) ;
		}
		,function(id,oldip,newip){
			for( let plugin_name in netIDCallbacks )
				if( netIDCallbacks[plugin_name].onIPAddressChangedCallback != undefined )
					netIDCallbacks[plugin_name].onIPAddressChangedCallback(id,oldip,newip) ;
		}
	) ;

	pluginInterface.setOnGetSettingsSchemaCallback( function(){
   		return new Promise((ac,rj)=>{
			exec('nmcli d', (err, stdout, stderr) => {
			  if (err){	ac({error:'No network available'}); return }
			  
			  let lines = stdout.split("\n") ;
			  if( lines.length<2 ){
			  	ac({error:'nmcli should be installed first. Execute\n\n'
			  		+'$ sudo apt-get install network-manager\n\nor\n\n$ sudo yum install NetworkManager'}) ;
			  	return ;
			  }
			  lines.shift() ;
			  if( lines.length==0 ){ ac({error:'No network available.'}) ; return ; }

			  try {
			  	var schema_json = JSON.parse(fs.readFileSync(pluginInterface.getpath()+'settings_schema.json').toString()) ;
				lines.forEach( line=>{
				  	let sp = line.trim().split(/\s+/) ;
				  	if( sp.length !=4 || sp[0]=='lo') return ;	// Illegally formatted line
				  	schema_json.properties.interface.enum.push(sp[0]) ;
				}) ;

				if( schema_json.properties.interface.enum.length==0 ){ ac({error:'No network available.'}) ; return ; }
		   			ac( schema_json ) ;
		   	  } catch(e){ac({error:'Illigally formatted admin/settings_schema.json'});} 
			});

		}) ;
	}) ;

	pluginInterface.setOnSettingsUpdatedCallback( function(newSettings){
		return new Promise((ac,rj)=>{
			/*exec('nmcli d', (err, stdout, stderr) => {
			  if (err){	rj(JSON.stringify(err,null,'\t')); return }
			  
			  let lines = stdout.split("\n") ;
			  if( lines.length<2 ){
			  	rj('nmcli should be installed first. Execute\n\n$ sudo apt-get install network-manager\n\nor\n\n$ sudo yum install NetworkManager') ;
			  	return ;
			  }
			  lines.shift() ;
			  if( lines.length==0 ){ rj('No network available.') ; return ; }

			  var re = "" ;
			  lines.forEach( line=>{
			  	re += line.split(/\s+/).join('|')+"\n" ;
			  })
			  rj(re);
			});*/

//			rj('Not implemented yet.') ;
			
			//var child = sudo(['cat','/etc/shadow'],{password:newSettings.root_passwd}) ;
			delete newSettings.root_passwd ;
			ac() ;
			//child.stdout.on('data', function (data) {
				//rj(data.toString()) ;
			//});

		}) ;
	}) ;

	// Plugin must return (possibly in promise) procedure call callback function.
	// The signature is ( method , devid , propertyname , argument )
	return onProcCall;
	//	return ( method , devid , propertyname , argument) => 'Admin proc call: '+procname+'('+JSON.stringify(argument)+')' ;
} ;

// Returns promise
exports.getNetIDFromIPv4Address_Forward = function(ipv4addr) {
	return ipv4.getNetIDFromIPv4Address(ipv4addr) ;
}

// callbacks_obj can contain the following four members
// onNewIDFoundCallback			: function(newid,newip) ;
// onIPAddressLostCallback		: function(id,lostip) ;
// onIPAddressRecoveredCallback	: function(id,recoveredip) ;
// onIPAddressChangedCallback	: function(id,oldip,newip) ;
var netIDCallbacks = {} ;
exports.setNetIDCallbacks_Forward = function(plugin_name , callbacks_obj) {
	netIDCallbacks[plugin_name] = callbacks_obj ;
} ;

function onProcCall( method , devid , propname , args ){
	switch(method){
	case 'GET' :
		return onProcCall_Get( method , devid , propname , args ) ;
	/*case 'POST' :
		if(devid!='settings' || args == undefined)
			return {error:'The format is wrong for settings.'} ;
		if( args.schedule instanceof Array && logger.updateschedule(args.schedule) )
			return {success:true,message:'New schedule settings are successfully saved'} ;
		else
			return {error:'Error in saving scheduled logging'} ;*/
	}
	return {error:`The specified method ${method} is not implemented in admin plugin.`} ;
}

function onProcCall_Get( method , serviceid , propname , args ){
	if( serviceid == undefined ){	// access 'admin/' => service list
		var re = { net:{} } ;
		var macs = ipv4.getmacs() ;
		for( var mac in macs )
			re.net[mac] = macs[mac].active ;

		if( args.option === 'true' )
			re.net.option={leaf:false,doc:{short:'Mac address of recognized network peers'}} ;

		return re ;
	}

	if( propname == undefined ){	// access 'admin/serviceid/' => property list
		var ret ;
		switch(serviceid){
			case 'net' :
				var macs = ipv4.getmacs() ;
				//log(JSON.stringify(macs)) ;
				ret = {} ;
				for( var mac in macs ){
					var ipaddr = (macs[mac].log.length==0?null:macs[mac].log[0].ip) ;
					ret[mac] = {
						active:macs[mac].active
						,ip:ipaddr
						,localhost:macs[mac].localhost
					} ;
					if( args.option === 'true' ){
						ret[mac].option = {
							leaf:true
							,doc:{short:(ipaddr==null?'IP:null':ipaddr)}
						}
					}
				}
				return ret ;
		}
		return {error:'No such service:'+serviceid} ;
	}

	switch(serviceid){
		case 'net' :
			var m = ipv4.getmacs()[propname] ;
			if( m == undefined )
				return {error:'No such mac address:'+propname} ;
			return m ;
	}
	return {error:'No such service:'+serviceid} ;
}
