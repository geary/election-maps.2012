// results-data-us.js
// By Michael Geary - http://mg.to/
// See UNLICENSE or http://unlicense.org/ for public domain notice.

	function getSeats( race, seat ) {
		if( ! race ) return null;
		if( seat == 'One' ) seat = '1';
		if( race[seat] ) return [ race[seat] ];
		if( race['NV'] ) return [ race['NV'] ];
		if( race['2006'] && race['2008'] ) return [ race['2006'], race['2008'] ];
		return null;
	}
	
	function totalReporting( results ) {
		var places = results.places;
		var counted = 0, total = 0;
		for( var name in places ) {
			var place = places[name];
			counted += place.counted;
			total += place.precincts;
		}
		return {
			counted: counted,
			total: total,
			percent: formatPercent( counted / total ),
			kind: ''  // TODO
		};
	}
	
	// Return a new array of cloned candidate objects, sorted by a given
	// key (e.g. electoralVotes) and then by votes, or just by votes. Sort
	// the result top down and trim to a max length.
	function getTopCandidates( result, sortBy, max ) {
		max = max || Infinity;
		if( ! result ) return [];

		// Clone the candidate list
		var top = [];
		// TODO(mg): It's possible at this point that result.candidates is either
		// an object, or an array.  This next bit is a total kludge.
		// Note: experimenting with clone vs. shallow reference
		if (result.candidates.length) {
			for( var i = 0; i < result.candidates.length; i++ ) {
				top.push( _.clone( result.candidates[i] ) );
			}
		} else {
			// It's a map, treat it as such:
			for( var name in result.candidates ) {
				top.push( _.clone( result.candidates[name] ) );
			}
		}
		var total = { votes: 0, electoralVotes: 0 };
		
		// Use trends data if applicable, and calculate total votes
		_.each( top, function( candidate ) {
			if( params.contest == 'president' )
				setCandidateTrendsVotes( result.id, candidate, sortBy );
			total.votes += candidate.votes;
		});
		
		// Calculate the relative fractions now that the total is available
		_.each( top, function( candidate ) {
			candidate.vsAll = candidate.votes / total.votes;
		});
		
		
		// Sort by a specified property and then by votes, or just by votes
		var sorter = sortBy;
		if( sortBy != 'votes' ) {
			sorter = function( candidate ) {
				var ev = candidate[sortBy] || 0;
				if( isNaN(ev) ) ev = 0;  // temp workaround it should not be NaN
				return ( ev * 1000000000 ) + candidate.votes ;
			};
		}
		top = sortArrayBy( top, sorter, { numeric:true } );
		
		// Sort in descending order and trim
		top = top.reverse().slice( 0, max );
		while( top.length  &&  ! top[top.length-1].votes )
			top.pop();
		
		// Finally can compare each candidate with the topmost
		if( top.length ) {
			var most = top[0].votes;
			_.each( top, function( candidate ) {
				candidate.vsTop = candidate.votes / most;
			});
		}
		
		return top;
	}
	
	function setCandidateTrendsVotes( stateName, candidate, sortBy ) {
		candidate.electoralVotes = 0;
		if( ! stateName  &&  state != stateUS ) stateName = state.name;
		if( stateName ) {
			// State
			// A most horrible kludge:
			if (stateName - 0 == stateName) {
				// We got a state ID instead, e.g. 25002.  Truncate to 2 chars and...
				stateName = State( stateName.substring(0, 2)).name;
			}
			var parties = trends.states[stateName].parties;
			if( ! parties.by ) indexArray( parties, 'id' );
			var party = parties.by.id[candidate.party];
			if( party ) {
				//console.log( candidate.lastName, candidate.votes, party.pv, party.ev );
				if( sortBy == 'electoralVotes' )
					candidate.electoralVotes = party.ev || 0;
			}
		}
		else {
			// Nationwide
			var party = trends.president.parties.by.id[candidate.party];
			if( party ) {
				//console.log( candidate.lastName, candidate.votes, party.popularVote, party.electoralVote );
				candidate.votes = party.popularVote;
				if( sortBy == 'electoralVotes' )
					candidate.electoralVotes = party.electoralVote;
			}
		}
	}
	
	function mayHaveResults( result ) {
		return result && (
			result.votes > 0  ||
			result.counted < result.precincts
		);
	}
	
	function getLeaders( locals ) {
		var leaders = {};
		for( var localname in locals ) {
			var votes = locals[localname].votes[0];
			if( votes ) leaders[votes.name] = true;
		}
		return leaders;
	}
	
	// Separate for speed
	function getLeadersN( locals, n ) {
		var leaders = {};
		for( var localname in locals ) {
			for( var i = 0;  i < n;  ++i ) {
				var votes = locals[localname].votes[i];
				if( votes ) leaders[votes.name] = true;
			}
		}
		return leaders;
	}
	
	var cacheResults = new Cache;
	
	var resultsTimer = {};
	
	function getResults() {
		var electionid =
			electionids.byStateContest( state.abbr, params.contest );
			//params.contest == 'house' ? null :  // TODO
			//state.electionidPrimary;
		if( ! electionid ) {
			loadTestResults( state.fips, false );
			return;
		}
		//if( state == stateUS  &&  view == 'county' )
		//	electionid = state.electionidPrimaryCounties;
		
		//if( electionid == 'random' ) {
		//	opt.randomized = params.randomize = true;
		//	electionid += state.fips;
		//}
		
		var results =
			( state != stateUS  ||  cacheResults.get( stateUS.electionidPrimaryDelegates ) )  &&
			cacheResults.get( electionid );
		if( results ) {
			gotResultsTable( electionid );
			return;
		}
		
		if( params.zero ) delete params.randomize;
		if( params.randomize || params.zero ) {
			loadTestResults( electionid, params.randomize );
			return;
		}
		
		var e = electionid.split( '|' );
		var id = params.source == 'gop' ? e[1] : e[0];
		
		getElections(
			state == stateUS ?
				[ id, electionids.byStateContest( 'US', 'trends' ) ] :
				[ id ]
		);
	}
	
	var electionLoading, electionsPending = [];
	function getElections( electionids ) {
		electionLoading = electionids[0];
		electionsPending = [].concat( electionids );
		_.each( electionids, function( electionid ) {
			resultsTimer[electionid] = { start: now() };
			var url = ( params.results == 'static' ) ?
				S(
					'http://election-maps.appspot.com/results/results/', electionid, '.js'
				) :
				S(
					'https://pollinglocation.googleapis.com/results?',
					'electionid=', electionid,
					'&_=', Math.floor( now() / opt.resultCacheTime )
				);
			getScript( url );
		});
	}
	
	function loadTestResults( electionid, randomize ) {
		var random = randomize ? randomInt : function() { return 0; };
		delete params.randomize;
		
		var col = [];
		_.each( election.candidates, function( candidate ) {
			if( candidate.skip ) return;
			col.push( 'TabCount-' + candidate.id );
		});
		col = col.concat(
			'ID',
			'TabTotal',
			'NumBallotBoxes',
			'NumCountedBallotBoxes'
		);
		indexArray( col );
		
		var kind =
			params.contest == 'house' ? 'house' :
			state.votesby || 'county';
		var isDelegates = ( electionid == state.electionidPrimaryDelegates );  // TEMP
		if( state == stateUS  &&  view == 'county'  &&  ! isDelegates ) kind = 'county';  // TEMP
		if( kind == 'town'  ||  kind == 'district' ) kind = 'county';  // TEMP
		var rows = _.map( state.geo[kind].features, function( feature ) {
			var row = [];
			row[col.ID] = feature.id;
			var nVoters = 0;
			var nPrecincts = row[col.NumBallotBoxes] = random( 50 ) + 5;
			var nCounted = row[col.NumCountedBallotBoxes] =
				Math.max( 0,
					Math.min( nPrecincts,
						random( nPrecincts * 2 ) -
						Math.floor( nPrecincts / 2 )
					)
				);
			var total = 0;
			for( iCol = -1;  ++iCol < col.ID; )
				total += row[iCol] = nCounted ? random(100000) : 0;
			row[col.TabTotal] = total + random(total*2);
			return row;
		});
		
		var json = {
			electionid: electionid,
			mode: 'test',
			table: {
				cols: col,
				rows: rows
			}
		};
		
		loadResultTable( json );
	}
	
	loadResults = function( json, electionid, mode ) {
		deleteFromArray( electionsPending, electionid );
		json.electionid = '' + electionid;
		json.mode = mode;
		loadResultTable( json );
	};
	
	// Hack for featureResult, not localized
	var lsadSuffixes = {
		city: ' City',
		county: ' County'
	};
	
	function featureResult( results, feature ) {
		if( !( results && feature ) ) return null;
		var id = feature.id, fips = feature.fips, state = feature.state;
		var split = fips && fips.split('US');
		if( split && split[1] ) fips = split[1];
		//var state = fips.length == 2  &&  states.by.fips[fips];  // TEMP
		//var abbr = state && state.abbr;  // TEMP
		//feature.state = state || states.by.fips[ fips.slice(0,2) ];
		return (
			results.places[ id ] ||
			results.places[ fips ] ||
			results.places[ state && state.abbr || '~' ] ||  // TEMP
			results.places[ feature.name ]  ||
			results.places[ feature.name + (
				lsadSuffixes[ ( feature.lsad || '' ).toLowerCase() ]
				|| ''
			) ]
		);
	}
	
	function fixShortFIPS( col, rows ) {
		_.each( rows, function( row ) {
			var id = row[col];
			if( /^\d\d\d\d$/.test(id) ) row[col] = '0' + id;
		});
	}
	
	function isCountyTEMP( json ) {
		try {
			var table = json.table, cols = table.cols, rows = table.rows;
			var col = indexArray( cols )['ID'];
			var id = rows[0][col];
			/*if( /^\d\d\d\d$/.test(id) )*/ fixShortFIPS( col, rows );
			return ! /^[A-Z][A-Z]$/.test(id);
		}
		catch( e ) {
			return false;
		}
	}
	
	var missingOK = {
		US: { AS:1, GU:1, MP:1, PR:1, VI:1 }
	};
	
	function loadResultTable( json ) {
		resultsTimer[json.electionid].fetch = now();
		//var counties = isCountyTEMP( json );
		cacheResults.add( json.electionid, json, opt.resultCacheTime );
		
		var eid = electionids[json.electionid];
		if( ! eid ) {
			window.console && console.log( 'No election ID ' + json.electionid );
			return;
		}
		if( eid.electionid == electionids.byStateContest( 'US', 'trends' ) ) {
			loadTrends( json );
			gotResultsTable( json.electionid );
			return;
		}
		
		var results = json.table;
		var state = results.state = State( eid.state );
/*
		var isDelegates = ( json.electionid == state.electionidPrimaryDelegates );
		if( isDelegates )
			state.delegates = results;
		else if( state == stateUS  &&  view == 'county' )
			state.resultsCounty = results;
		else
*/
		state.results[params.contest] = results;
		results.mode = json.mode;
		var zero = ( json.mode == 'test'  &&  ! debug );
		
		var cols = results.cols;
		indexArray( cols );
		var colsID = cols.ID, nCandidates = colsID / 4;
		
		//var candidates = results.candidates = [];
		//for( var i = 0, colID = col.ID;  i < colID;  ++i ) {
		//	var idCandidate = cols[i].split('-')[1].toLowerCase(), candidate = election.candidates.by.id[idCandidate];
		//	candidates.push( $.extend( {}, candidate ) );
		//}
		//indexArray( candidates, 'id' );
		
		var fix = state.fix || {};
		
		var kind =
			params.contest == 'house' ? 'house' :
			state.votesby || 'county';
		//if( state == stateUS  &&  view == 'county'  &&  ! isDelegates ) kind = 'county';  // TEMP
		if( kind == 'town'  ||  kind == 'district' ) kind = 'county';  // TEMP
		var features = state.geo[kind].features;
		
		var parties = election.parties;
		var missing = [];
		var rows = results.rows;
		var places = results.places = {};
		var allCandidates = results.candidates = {};
		for( var iRow = 0, nRows = rows.length;  iRow < nRows;  ++iRow ) {
			var row = rows[iRow];
			var idPlace = row[colsID];
			idPlace = fix[idPlace] || idPlace;
			var votes = row[cols.TabTotal];
			var precincts = row[cols.NumBallotBoxes];
			var counted = row[cols.NumCountedBallotBoxes];
			var winnerIndex = -1;
			// Note that this works only because the winner column is
			// a string. If it were a number this would fail on a 0 value.
			if ( row[cols.Winner] ) {
				winnerIndex = row[cols.Winner];
			}
			if( state.geo ) {
				var feature = features.by[idPlace];
				if( ! feature ) {
					var ok = missingOK[state.abbr];
					if( !( ok  &&  idPlace in ok ) )
						if( ! features.didMissingCheck )
							missing.push( idPlace );
				}
			}
			
			//if( /^\d\d000$/.test(idPlace) ) rowsByID[idPlace.slice(0,2)] = row;
			//var nCandidates = candidates.length;
			var totalVotes = 0, maxVotes = 0,  iMaxVotes = -1;
			if( zero ) {
				for( iCol = 0;  iCol < colsID;  iCol += 4 ) {
					row[iCol] = 0;
				}
				row[cols.NumCountedBallotBoxes] = 0;
			}
			var candidates = [];
			var winnerParty = null;
			for( iCol = 0;  iCol < colsID;  iCol += 4 ) {
				var party = row[iCol+3];
				if( ! party ) break;
				if( ! parties[party] ) {
					params.debug && window.console && console.log( party );
					parties[party] = { color: '#808080' };
				}
				var firstName = row[iCol+1], lastName = row[iCol+2];
				var idCandidate = firstName + ' ' + lastName, votes = row[iCol];
				var winner = ( winnerIndex == iCol/4 );
				if( winner )
					winnerParty = party;
				var candidate = {
					id: idCandidate,
					votes: votes,
					winner: winner,
					firstName: firstName,
					lastName: lastName,
					party: party
				};
				if( ! allCandidates[idCandidate] ) {
					allCandidates[idCandidate] = {
						id: idCandidate,
						votes: 0,
						firstName: firstName,
						lastName: lastName,
						party: party
					};
				}
				allCandidates[idCandidate].votes += votes;
				totalVotes += votes;
				if( maxVotes < votes ) {
					maxVotes = votes;
					iMaxVotes = candidates.length;
				}
				candidates.push( candidate );
			}
			indexArray( candidates, 'id' );
			var result = {
				id: idPlace,
				precincts: row[cols.NumBallotBoxes],
				counted: row[cols.NumCountedBallotBoxes],
				votes: totalVotes,
				winnerParty: winnerParty,
				candidates: candidates,
				iMaxVotes: iMaxVotes
			};
			if( params.debug == 'zero'  &&  result.precincts == 0 ) {
				console.log( S( 'Zero precincts: ', idPlace ) );
			}
			if( params.debug == 'incomplete'  &&  result.counted < result.precincts ) {
				console.log( S(
					'Incomplete: ', idPlace, ' ',
					result.counted + '/' + result.precincts
				) );
			}
			places[result.id] = result;
		}
		results.oldtemp = { cols: results.cols, rows: results.rows };  // TEMP debugging
		delete results.cols;
		delete results.rows;
		features.didMissingCheck = true;
		
		if( missing.length  &&  debug  &&  debug != 'quiet' ) {
			if( debug == 'fulltest' ) {
				allMissing += S(
					'\n',
					'Missing locations for ',
					state.abbr, ' ', params.contest, '\n',
					missing.sort().join( '\n' ), '\n'
				);
			}
			else {
				alert( S( 'Missing locations:\n', missing.sort().join( '\n' ) ) );
			}
		}
		
		gotResultsTable( json.electionid );
	}
	
	function gotResultsTable( electionid ) {
		logResultsTimes( electionid );
		if( electionsPending.length == 0 ) {
			if( params.debug == 'fulltest' )
				nextElection();
			else
				geoReady();
		}
	}
	
	var eidIndex = 0, allMissing = '';
	function nextElection() {
		var eid = electionidlist[++eidIndex];
		if( eid == '2919|trends|US' ) {
			finishFullTest();
		}
		else {
			console.log( S(
				'Loading ', eidIndex+1, ' of ', electionidlist.length - 2
			) );
			var f = eid.split('|'), c = f[1], s = f[2];
			params.contest = c;
			state = null;
			setState( s, 'fulltest' );
		}
	}
	
	function finishFullTest() {
		console.log( S(
			allMissing,  '\n\nTest complete!\n'
		) );
	}
	
	function logResultsTimes( electionid ) {
		function n( n ) { return ( n / 1000 ).toFixed( 3 ); }
		if( params.debug  &&  window.console  &&  console.log ) {
			var t = resultsTimer[electionid];
			t.process = now();
			console.log( S(
				'electionid ', electionid,
				' get:', n( t.fetch - t.start ),
				' process:', n( t.process - t.fetch )
			) );
		}
	}
	
	var presByState = 'Presidential results by State';
	
	function fixupTrends( trendsIn ) {
		function change( from, to ) {
			if( trends[from] ) {
				trends[to] = trends[from];
				delete trends[from];
			}
		}
		var trends = {};
		_.each( trendsIn.results, function( trend ) {
			if( trend.name == presByState )
				trends.states = fixupTrendStates( trend.states );
			else
				for( var key in trend ) {
					trends[key] = fixupTrend( trend[key] );
			}
		});
		change( 'governors', 'governor' );
		return trends;
	}
	
	function fixupTrend( trend ) {
		trend.parties = [];
		_.each( trend.rows, function( row ) {
			var party = {};
			_.each( trend.cols, function( key, i ) {
				party[key] = row[i];
			});
			trend.parties.push( party );
		});
		delete trend.cols;
		delete trend.rows;
		indexArray( trend.parties, 'id' );
		return trend;
	}
	
	function fixupTrendStates( statesIn ) {
		var states = {}
		_.each( statesIn, function( state ) {
			states[state.id] = state;
		});
		return states;
	}
	
	var trends;
	function loadTrends( json ) {
		trends = fixupTrends( json );
	}
