/*
 *  ::718604!
 * 
 * Copyright(C) November 20, 2014 U.S. Food and Drug Administration
 * Authors: Dr. Vahan Simonyan (1), Dr. Raja Mazumder (2), et al
 * Affiliation: Food and Drug Administration (1), George Washington University (2)
 * 
 * All rights Reserved.
 * 
 * The MIT License (MIT)
 * 
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
// _/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
// _/
// _/ Graph viewer
// _/
// _/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/

vjUnitMatrix = matrixIdentity(4);

javaScriptEngine.include("js-graph/vjSVG_pathSeg_polyfill.js");

var vjSVGElementSource='http://www.w3.org/2000/svg';

/*! Modify or append a trivial child to an SVG element
 * \param obj An SVG element
 * \param tagName Tag name of child
 * \param data textContent of child
 * \param options Options object; options.unshift means if the child is to be appended,
 * it will be unshifted (inserted as the first child)
 */
function vjSVGSetTrivialChild(obj, tagName, data, options)
{
    for (var c = obj.firstChild; c; c = c.nextSibling)
        if (c.tagName === tagName) {
            c.textContent = data;
            return;
        }

    var elt = document.createElementNS(vjSVGElementSource, tagName);
    elt.textContent = data;
    if (options && options.unshift && obj.firstChild)
        obj.insertBefore(elt, obj.firstChild);
    else
        obj.appendChild(elt);
}

/*! Remove trivial children from an SVG element
 * \param obj An SVG element
 * \param tagName Tag name of children to remove
 */
function vjSVGClearTrivialChildren(obj, tagName)
{
    var c = obj.firstChild;
    while (c) {
        if (c.tagName === tagName) {
            var nextSibling = c.nextSibling;
            obj.removeChild(c);
            c = nextSibling;
        } else {
            c = c.nextSibling;
        }
    }
}

/*! Get textContent of a trivial child of an SVG element
 * \param obj An SVG element
 * \param tagName Tag name of child
 * \return textContent of child if found, undefined otherwise.
 */
function vjSVGGetTrivialChild(obj, tagName)
{
    for (var c = obj.firstChild; c; c = c.nextSibling)
        if (c.tagName === tagName)
            return c.textContent;
    return undefined;
}

/*! Returns a function for coordinate transforms which preserves aspect ratio
 *  and (optionally) the orientation
 * \param matrix 4x4 affine transformation matrix
 */
function vjSVGMakeAspectPreserver(matrix)
{
    var TSR = matrixAffineTSRDecompose(matrix);
    var equalized_S = matrixCopy(TSR.S); // xy-aspect equalized S
    var minScale = Math.min(Math.abs(equalized_S[0][0]), Math.abs(equalized_S[1][1]));
    for (var i=0; i<2; i++) {
        if (equalized_S[i][i] > 0 && equalized_S[i][i] > minScale)
            equalized_S[i][i] = minScale;
        else if (equalized_S[i][i] < 0 && equalized_S[i][i] < -minScale)
            equalized_S[i][i] = -minScale;
    }

    var equalized_SR = matrixMultiplication(equalized_S, TSR.R);
    var SR = matrixMultiplication(TSR.S, TSR.R);

    /*! \param center Point (in coordinates suitable as rhs for TSR) to be used as the
                      "center" for the transform. E.g. the center of element to draw.
        \param noRotate If true, the rotation will be skipped. Note that reflection
                        may still occur, so this is suitable only for symmetric cases.
     */
    return function(center, noRotate, noScale) {
        var SRcenter = matrixMultiplicationToVector(SR, center);
        var offset_T = matrixCopy(TSR.T); // centered T
        offset_T[0][3] += SRcenter.x;
        offset_T[1][3] += SRcenter.y;
        offset_T[2][3] += SRcenter.z;

        var C = matrixIdentity(4);
        C[0][3] = -center.x;
        C[1][3] = -center.y;
        C[2][3] = center.z ? -center.z : 0;

        var offset_SR = noScale ? C : matrixMultiplication(noRotate ? equalized_S : equalized_SR, C);

        return matrixMultiplication(offset_T, offset_SR);
    };
}

function vjSVGRoundPixel(val)
{
    // round to 1/10 px
    return Math.round(10 * val) / 10;
}

    // _/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/
    // _/
    // _/ Base class handling all of the drawing platform dependent functionality
    // _/
    // _/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/

function vjSVGBase( svg,  model )
{
    this.elementSource=vjSVGElementSource;
    this.svg=svg;

    // _/_/_/_/_/_/_/_/_/_/_/
    // _/
    // _/ stacking of attributes, and transformation
    // _/
    // _/_/_/_/_/_/_/_/_/_/_/
    this.pushArray=function(array,whattopush)    { array.push(whattopush); };

    this.popArray=function(array, force)
    {    // do not pop out the last element
        if(force || array.length>1)
            return array.pop();
        else return array[0];
    };

    this.getCurrentFromArray=function(array) {    return array[array.length-1];  };

    // _/_/_/_/_/_/_/_/_/_/_/
    // _/
    // _/ setters for Generic attributes
    // _/
    // _/_/_/_/_/_/_/_/_/_/_/

    // -------------------------------------------------------------HANDLERS
    this.handlerArray = new Array();
    this.setHandler = function(obj) // color, width, opacity
    {
        this.pushArray(this.handlerArray,obj);
    };
    this.getHandler = function() {
        return this.getCurrentFromArray(this.handlerArray);
    };
    this.popHandler = function() {
        return this.popArray(this.handlerArray, true);
    };
    // -------------------------------------------------------------PEN
        this.penArray = new Array();
    this.setPen = function(obj, is_default) // color, width, opacity
    { // alerJ("object",object)
        this.pushArray(this.penArray, this.ensureStyle(obj, "p", is_default));
    };
    this.getPen = function() {
        return this.getCurrentFromArray(this.penArray);
    };
    this.popPen = function() {
        return this.popArray(this.penArray);
    };

    // -------------------------------------------------------------BRUSH
    this.brushArray = new Array();
    this.setBrush = function(obj, is_default) {
        this.pushArray(this.brushArray, this.ensureStyle(obj, "b", is_default)); // NOTE : color can be
                                                // 'transparent'
    };
    this.getBrush = function() {
        return this.getCurrentFromArray(this.brushArray);
    };
    this.popBrush = function() {
        return this.popArray(this.brushArray);
    };
    // -------------------------------------------------------------FONT
    this.fontArray = [];
    this.setFont = function(obj, is_default) {
        this.pushArray(this.fontArray, this.ensureStyle(obj, "f", is_default));
    };
    this.getFont = function() {
        return this.getCurrentFromArray(this.fontArray);
    };
    this.popFont = function() {
        return this.popArray(this.fontArray);
    };

    this.styleCnt = 0;
    this.styleNames = {};
    this.styleNode = document.createElementNS(this.elementSource, "style");
    this.topGroupNode = document.createElementNS(this.elementSource, "g");
    this.topGroupNode.id = ("svg_top_g" + 10 * Math.random()).replace(".", "");
    this.curGroupNode = this.topGroupNode;
    
    
    this.ensureStyle = function(obj, cat, is_default) {
        var style_string = "";
        Object.getOwnPropertyNames(obj).sort().forEach(function(nam, i) {
            var val = obj[nam];
            if (nam === "font-size" && parseInt(val) == val) {
                val = val + "px";
            }
            style_string += (i ? " " : "") + nam + ":" + val + ";";
        });
        if (this.styleNames[style_string]) {
            return this.styleNames[style_string];
        }
        this.styleCnt++;
        var style_name = cat + this.styleCnt;
        this.styleNames[style_string] = style_name;
        if (is_default) {
            this.styleNode.textContent += "#" + this.topGroupNode.id + " { " + style_string + " }\n";
        }
        this.styleNode.textContent += "#" + this.topGroupNode.id + " ." + style_name + " { " + style_string + " }\n";

        return style_name;
    };
                            //this.setCurveCommand=function(curveCommand) {this.curveCommand=curveCommand;};
                            //this.setMoveCommand=function(curveCommand) {this.moveCommand=moveCommand;};
                            //this.setLineCommand=function(curveCommand) {this.lineCommand=lineCommand;};

    // _/_/_/_/_/_/_/_/_/_/_/
    // _/ Setters for Matrix Attributes
    // _/_/_/_/_/_/_/_/_/_/_/

    this.matrixArray=new Array(); // array of transformation matrix
    this.aspectPreserverArray=new Array(); // array of generators of corresponding aspect-preserving transformations
    this.matrixArray.push(vjUnitMatrix);
    this.aspectPreserverArray.push(vjSVGMakeAspectPreserver(vjUnitMatrix));

    this.setMatrix=function( newmatrix, newpreserver ) {
        this.pushArray(this.matrixArray, newmatrix);
        if (!newpreserver)
            newpreserver = vjSVGMakeAspectPreserver(newmatrix);
        this.pushArray(this.aspectPreserverArray, newpreserver);
    };
    this.getCurrentMatrix=function() {
        return this.getCurrentFromArray( this.matrixArray );
    };
    this.setAspectPreservingMatrix=function( crd, noRotate, noScale ) {
        var currentPreserver = this.getCurrentFromArray( this.aspectPreserverArray );
        var fakePreserver = function(c) { return c; };
        this.setMatrix(currentPreserver(crd, noRotate, noScale), fakePreserver);
    };
    this.popMatrix=function(){
        this.popArray(this.aspectPreserverArray);
        return this.popArray(this.matrixArray);
    };

    this.rotateMatrix=function(crd,vec, angle, donotpushmatrix )
    {
        if(!crd.z)crd.z=0;
        //alert('ttttt')
        var currentMatrix=this.getCurrentFromArray( this.matrixArray );

//        crd=this.multipleMatrixToVector(currentMatrix,crd);
        // find how to rotranslate 4x4 matrix around a point of origin and
        var angleRadian=angle*(Math.PI/180);
        var rotationMatrix= new Array();
        //alerJ("crd2",crd2)
        var cos=Math.cos(angleRadian);
        var sin=Math.sin(angleRadian);
        var t=1-cos;

        var u=vec.x;var u2=Math.pow(u,2);
        var v=vec.y;var v2=Math.pow(v,2);
        var w=vec.z;var w2=Math.pow(w,2);
        var L=Math.pow(u,2)+Math.pow(v,2)+Math.pow(w,2);
        //alert(L)
        var tx=((crd.x*(v2+w2)-u*(crd.y*v+crd.z*w))*t+(crd.y*w-crd.z*v)*Math.sqrt(L)*sin)/L;
        var ty=((crd.y*(u2+w2)-v*(crd.x*u+crd.z*w))*t+(crd.z*u-crd.x*w)*Math.sqrt(L)*sin)/L;
        var tz=((crd.z*(u2+v2)-w*(crd.x*u+crd.y*v))*t+(crd.x*v-crd.y*u)*Math.sqrt(L)*sin)/L;

        //alerJ(' '+((crd.x*(v2+w2)-u*(crd.y*v+crd.z*w))*t)/L,rotationMatrix);


        rotationMatrix.push([     (u2+(v2+w2)*cos)/L      , (u*v*t-w*Math.sqrt(L)*sin)/L , (u*w*t+v*Math.sqrt(L)*sin)/L  , tx ],
                            [(u*v*t+w*Math.sqrt(L)*sin)/L ,      (v2+(u2+w2)*cos)/L      , (v*w*t-u*Math.sqrt(L)*sin)/L  , ty ],
                            [(u*w*t-v*Math.sqrt(L)*sin)/L , (v*w*t+u*Math.sqrt(L)*sin)/L ,       (w2+(u2+v2)*cos)/L      , tz ],
                            [              0              ,               0              ,               0               , 1 ]);
//        alerJ("rotation point",crd);
//        alerJ("Rotation Matrix",rotationMatrix);
//        alerJ("Matrix BEFORE rotation",currentMatrix);
        currentMatrix=matrixMultiplication(currentMatrix,rotationMatrix);
//        alerJ("Matrix AFTER rotation",currentMatrix);
        if(!donotpushmatrix)
            this.setMatrix(currentMatrix);
        return currentMatrix;
        //alerJ("currentMatrix",currentMatrix)
    };

    this.translateMatrix=function( shiftCrd, donotpushmatrix )
    {
        var currentMatrix=this.getCurrentFromArray( this.matrixArray );
        if (!shiftCrd.z) shiftCrd.z=0;

        var translationMatrix=new Array([ 1 , 0 , 0 , shiftCrd.x ],
                                        [ 0 , 1 , 0 , shiftCrd.y ],
                                        [ 0 , 0 , 1 , shiftCrd.z ],
                                        [ 0 , 0 , 0 ,      1     ]);

        currentMatrix=matrixMultiplication(currentMatrix,translationMatrix);

        if(!donotpushmatrix)
            this.setMatrix(currentMatrix);
        return currentMatrix;
        //this.setMatrix(currentMatrix);
    };

    this.scaleMatrix=function( scaleCrd, donotpushmatrix)
    {
        if(!scaleCrd.z)scaleCrd.z=0;
        var currentMatrix=this.getCurrentFromArray( this.matrixArray );
        if (!scaleCrd.z) scaleCrd.z=0;

        var scaleMatrix=new Array([ scaleCrd.x ,      0     ,     0      , 0 ],
                                  [      0     , scaleCrd.y ,     0      , 0 ],
                                  [      0     ,      0     , scaleCrd.z , 0 ],
                                  [      0     ,      0     ,     0      , 1 ]);

        currentMatrix=matrixMultiplication(currentMatrix,scaleMatrix);
        if(!donotpushmatrix)
            this.setMatrix(currentMatrix);
        return currentMatrix;
    };

    this.scaleSize=function( size , whichaxis, angle )
    {
        if(whichaxis===undefined)whichaxis=1;
        var currentMatrix=this.getCurrentFromArray( this.matrixArray );
        var  sizeset=[0,0,0];
        for( var iv=0; iv< 3 ; ++ iv )  {
            sizeset[0]+=currentMatrix[iv][0]*currentMatrix[iv][0];
            sizeset[1]+=currentMatrix[iv][1]*currentMatrix[iv][1];
            sizeset[2]+=currentMatrix[iv][2]*currentMatrix[iv][2];
        }
        if(!angle)angle=0;
        return Math.cos(angle)*size/Math.sqrt(sizeset[whichaxis]);
    };

    // ????????????????????????????????????? ?????????????????????????????????????
    //
    //
    //

    this.createObjWithDefaultAttributes=function(objtype, callee_arguments )
    {


        this.obj = document.createElementNS(this.elementSource, objtype);
        this.obj.currentMatrix = this.getCurrentFromArray(this.matrixArray);
        this.obj.currentInvertedMatrix = matrixInverse(this.getCurrentFromArray(this.matrixArray));
        //this.obj.id=this.getSVGID();
        //var handlers=this.getHandler();
        //alerJ("callee_arguments",callee_arguments)
//        transferAttributes(this.obj,this.getHandler());

        if (this.styleNode && !this.styleNode.parentNode) {
            this.svg.insertBefore(this.styleNode, this.svg.firstChild);
            this.svg.appendChild(this.topGroupNode);
        }

        if (objtype!="image"){
            classListAdd(this.obj, this.getPen());
            classListAdd(this.obj, this.getBrush());
        }

        if(objtype=="text"){
            classListAdd(this.obj, this.getFont());
        }

        if(callee_arguments) {
            var vargs=callee_arguments.callee.toString().match(/^[^\(]+\(([^\)]*)\)/)[1].split(/\s*,\s*/);

            var arg_crd, arg_width, arg_height;

            for( var ii=0; ii<vargs.length; ++ii) {
                if(vargs[ii].indexOf("crd")==0){// || vargs[ii].indexOf("obj")==0){
                    // save untransformed coordinate for width/height calculation
                    arg_crd = {x: callee_arguments[ii].x, y: callee_arguments[ii].y, z: callee_arguments[ii].z};
                    for ( ff in callee_arguments[ii] ) {
                        if (ff === "z") {
                            // z not used in svg
                            continue;
                        }
                        var currentCoordinate=callee_arguments[ii];
                        if(currentCoordinate.x===undefined)currentCoordinate.x=0;if(currentCoordinate.y===undefined)currentCoordinate.y=0;if(currentCoordinate.z===undefined)currentCoordinate.z=0;
                        currentCoordinate=matrixMultiplicationToVector(this.getCurrentFromArray( this.matrixArray ), currentCoordinate);
                        if (this.transform) {
                            currentCoordinate = this.transform(currentCoordinate);
                        }
                        var crd_attr_name = ff;
                        if (objtype == "circle") {
                            crd_attr_name = "c" + ff; // cx, cy
                        }
                        this.obj.setAttribute(crd_attr_name, vjSVGRoundPixel(currentCoordinate[ff]));
                    }
                }
                else{//if(vargs[ii]==="d"){
                    //alert("varg{ii } " + vargs[ii])
                    //alert("calle " + callee_arguments[ii])
                    if (vargs[ii] === "d" && callee_arguments[ii].indexOf("NaN") !== -1) {
                        //alert("calle NaN " + callee_arguments[ii])
                        continue;
                    } else if (vargs[ii] === "width") {
                        arg_width = callee_arguments[ii];
                        continue;
                    } else if (vargs[ii] === "height") {
                        arg_height = callee_arguments[ii];
                        continue;
                    } else if (vargs[ii] === "url") {
                        this.obj.setAttributeNS("http://www.w3.org/1999/xlink", "href", callee_arguments[ii]);
                        continue;
                    } else if (vargs[ii] === "preserveAspectRatio" && callee_arguments[ii] === undefined) {
                        continue;
                    } else if (vargs[ii] === "objAttr" || callee_arguments[ii] === undefined) {
                        continue;
                    } else {
                        this.obj.setAttribute(vargs[ii], callee_arguments[ii]);
                        //if (vargs[ii]==="objID") alert(callee_arguments[ii]);
                    }
                    //this.obj.setAttribute(vargs[ii],callee_arguments[ii]);
                    if (vargs[ii]=="d"){
                        var startCrd = callee_arguments[ii].split("L")[0];
                        var xCrd = startCrd.split(",")[0].split("M")[1];
                        var yCrd = startCrd.split(",")[1];
                        this.obj.setAttribute("x", vjSVGRoundPixel(parseFloat(xCrd)));
                        this.obj.setAttribute("y", vjSVGRoundPixel(parseFloat(yCrd)));
                    }
                }
            }

            if (arg_width !== undefined) {
                var crd2 = matrixMultiplicationToVector(this.getCurrentFromArray(this.matrixArray), {x: arg_crd.x + arg_width, y: arg_crd.y, z: arg_crd.z});
                var width = crd2.x - parseFloat(this.obj.getAttribute("x"));
                if (width >= 0) {
                    this.obj.setAttribute("width", vjSVGRoundPixel(width));
                } else {
                    this.obj.setAttribute("width", vjSVGRoundPixel(-width));
                    this.obj.setAttribute("x", vjSVGRoundPixel(parseFloat(this.obj.getAttribute("x")) + width));
                }
            }

            if (arg_height !== undefined) {
                var crd2 = matrixMultiplicationToVector(this.getCurrentFromArray(this.matrixArray), {x: arg_crd.x, y: arg_crd.y + arg_height, z: arg_crd.z});
                var height = crd2.y - parseFloat(this.obj.getAttribute("y"));
                if (height >= 0) {
                    this.obj.setAttribute("height", vjSVGRoundPixel(height));
                } else {
                    this.obj.setAttribute("height", vjSVGRoundPixel(-height));
                    this.obj.setAttribute("y", vjSVGRoundPixel(parseFloat(this.obj.getAttribute("y")) + height));
                }
            }

            this.curGroupNode.appendChild(this.obj);
        }

        var handler=this.getHandler();
        for (var ii in handler){
            this.obj[ii] = function(funcname, obj) {return function(evt) {vjSVG_GIhandler(funcname, obj, evt);};}(handler[ii], this.obj);
            //'vjSVG_GIhandler(\"'+handler[ii]+'\",\"'+this.obj.id+'\",evt);');//,\"'+this.coordinates[0].irow+'\");'; //call whatever function from the wrapper
        }
//        if(callee_arguments) {
//            var vargs=callee_arguments.callee.toString().match(/^[^\(]+\(([^\)]*)\)/)[1].split(/\s*,\s*/);
//            //alert(vargs.length)
//            var flag=0;
//            var str=String(vargs);
//            var xText=0;
//            var yText=0;
//            if (str.search("text")!=-1) flag=1;
//
//            for( var ii=0; ii<vargs.length; ++ii) {
//
//                if(vargs[ii].indexOf("obj")==0 || vargs[ii].indexOf("crd")==0){
//
//                    var suffix=vargs[ii].substring(3);
//                    for ( ff in callee_arguments[ii] ) {
//                        //alerJ("dd",callee_arguments[ii])
//                        var currentCoordinate=callee_arguments[ii];
//                        if(!currentCoordinate.z)currentCoordinate.z=0;
//
//                        //alert("flag "+ flag +"ff: " + ff +" - "+ ii + " - " + currentCoordinate.x + " y  " + currentCoordinate.y)
//
//                        alerJ("matrix to transform element",this.getCurrentFromArray( this.matrixArray ));
//                        currentCoordinate=this.multipleMatrixToVector(this.getCurrentFromArray( this.matrixArray ), currentCoordinate);
//                        alerJ("TRANSFORMED cordinates element in TRAJECTORY",currentCoordinate);
//                        if (flag==1) {
//                            xText=currentCoordinate.x;
//                            yText=currentCoordinate.y;
//                            obj.setAttribute('x',xText);
//                            obj.setAttribute('y',yText);
//
//                        }
//                        else {
//                        obj.setAttribute(ff+suffix,currentCoordinate);
//                        }
//                        //alerJ(ff+suffix + " " + callee_arguments[ii][ff]);
//                    }
//
//                    }
//                if (flag==1 || callee_arguments[3]){
//                       var transfo='rotate('+ callee_arguments[3] + " " + xText + " " + yText +")";
//                       obj.setAttribute('transform',transfo);
//
//                }
//                else obj.setAttribute(vargs[ii],callee_arguments[ii] );
//            }
//            this.curGroupNode.appendChild(obj);
//        }
        return this.obj;
    };

    // title & desc tags (added as children of graphical elements for tooltips and accessibility)
    this.setTitle = function(data) { return vjSVGSetTrivialChild(this.obj, "title", data, {unshift:true}); };
    this.clearTitle = function() { return vjSVGClearTrivialChildren(this.obj, "title"); };
    this.getTitle = function() { return vjSVGGetTrivialChild(this.obj, "title"); };
    this.setDesc = function(data) { return vjSVGSetTrivialChild(this.obj, "desc", data); };
    this.clearDesc = function() { return vjSVGClearTrivialChildren(this.obj, "desc"); };
    this.getDesc = function() { return vjSVGGetTrivialChild(this.obj, "desc"); };
    this.setNewAttribute = function(ObjAttribute) { // ObjAttribute={newTag:argument}
        if (ObjAttribute.length) return;
        //alert("new")
        var keys = Object.keys(ObjAttribute);
        for (var e=0;e<keys.length;e++){
            var tag = keys[e];
            var value = ObjAttribute[tag];
            this.obj.setAttribute(tag,value);
        }
        //this.obj.setAttribute
    }
    // container for grouping elements together
    this.group=function(objID)
    {
        return this.createObjWithDefaultAttributes("g", arguments);
    };

    // _/_/_/_/_/_/_/_/_/_/_/
    // _/ PATH function
    // _/_/_/_/_/_/_/_/_/_/_/

    this.path=function(d, objID)
    {
        return this.createObjWithDefaultAttributes( 'path',arguments );
    };

    this.trajectory=function(coordinates,closed, lineCmd, objID)
    {
        //alerJ("debug point 1  ", this.getCurrentFromArray( this.matrixArray ))
        //alerJ("cor ",coordinates)
        if(!lineCmd)lineCmd='L';
        var argCord=1;
        switch (lineCmd) {
        case 'S':
        case 's':
        case 'Q':
        case 'q':
        case 'SR':
        case 'sR':
        case 'QR':
        case 'qR':
            argCord = 2;
            break;
        case 'C':
        case 'c':
        case 'CR':
        case 'cR':
            argCord = 3;
            break;
        default:
            argCord = 1;
        }

        var d="";
        d+="M";
        coordinates[0].x=parseFloat(coordinates[0].x);
        coordinates[0].y=parseFloat(coordinates[0].y);
        coordinates[0].z=parseFloat(coordinates[0].z);
        if (isNaN(coordinates[0].z))
            coordinates[0].z = 0;
        currentCoordinate=matrixMultiplicationToVector(this.getCurrentFromArray( this.matrixArray ), coordinates[0]);
//      if(__getEnvironment()=="mobile") {
//          console.log(e.clientX,e.clientY);
//          sessionStorage.setItem("coords",currentCoordinate);
//      }
          if (this.transform) {
              currentCoordinate = this.transform(currentCoordinate);
          }
        d+=vjSVGRoundPixel(currentCoordinate.x)+","+vjSVGRoundPixel(currentCoordinate.y) +" ";
        ic=0;
        for(var ic=1; ic<coordinates.length; ic+=argCord)  {

            d+=lineCmd;//.substring(0, 1);
            for(var il=0;il<argCord && il+ic<coordinates.length;il++){
                coordinates[ic+il].x=parseFloat(coordinates[ic+il].x);
                coordinates[ic+il].y=parseFloat(coordinates[ic+il].y);
                coordinates[ic+il].z=parseFloat(coordinates[ic+il].z);
                if (isNaN(coordinates[ic+il].z))
                    coordinates[ic+il].z = 0;

                currentCoordinate=matrixMultiplicationToVector(this.getCurrentFromArray( this.matrixArray ), coordinates[ic+il]);
                if (this.transform) {
                    currentCoordinate = this.transform(currentCoordinate);
                }
                /*if (currentCoordinate.x == "NaN" ) {
                    alert("attention " + " x " + currentCoordinate.x + " y " + currentCoordinate.y)
                    alert(" x Na: " + coordinates[ic+il].x + "/ y: " + coordinates[ic+il].y + "/ z: " + coordinates[ic+il].z + "/" )
                }*/
                d+=vjSVGRoundPixel(currentCoordinate.x)+","+vjSVGRoundPixel(currentCoordinate.y) +" ";
//                if(lineCmd.indexOf("R")!=-1){
//                    if(il>=argCord)argCord=1;
//                    lineCmd="T";
//                }
            }

        }
        var remainCoord=(coordinates.length-1)%argCord;
        for(var i=0; i<remainCoord;++i){
            currentCoordinate=matrixMultiplicationToVector(this.getCurrentFromArray( this.matrixArray ), coordinates[coordinates.length-1]);
            if (this.transform) {
                currentCoordinate = this.transform(currentCoordinate);
            }
            d+=vjSVGRoundPixel(currentCoordinate.x)+","+vjSVGRoundPixel(currentCoordinate.y) +" ";
        }
        if(closed==1)d+="Z";
        //alert(d)
        return this.path(d, objID);
    };


    this.point=function(crd,objID)
    {
        return this.createObjWithDefaultAttributes( 'point', objID );
    };


    this.text=function(crd,objAttr)//text,isVertical,angle)
    {
        var obj = this.createObjWithDefaultAttributes('text', arguments);
        obj.textContent = objAttr.text;
        if (objAttr.angle)
            obj.setAttribute('transform',"rotate(-"+ objAttr.angle + " " + obj.attributes.x.value + " " + obj.attributes.y.value +")");
        var setAttrs = ["dx", "dy", "text-anchor"];
        for (var i=0; i<setAttrs.length; i++)
            if (objAttr[setAttrs[i]])
                obj.setAttribute(setAttrs[i], objAttr[setAttrs[i]]);
        if (objAttr.ellipsizeWidth) {
            var trimmed = false;
            for (var i=1; i<=objAttr.text.length; i++) {
                if (this.scaleSize(obj.getComputedTextLength(),0,objAttr.angle) <= objAttr.ellipsizeWidth)
                    break;
                obj.textContent = objAttr.text.substring(0, (objAttr.text.length-i)/2) + "..." + objAttr.text.substring((objAttr.text.length+i)/2, objAttr.text.length);
                trimmed = true;
            }
            if(objAttr.title === undefined && trimmed) {
                var auto_title = document.createElementNS("http://www.w3.org/2000/svg","title");
                auto_title.textContent = objAttr.text;
                obj.appendChild(auto_title);
            }
        }
        return obj;
    };


    this.image=function(crd, url, width, height, preserveAspectRatio) {
        return this.createObjWithDefaultAttributes('image', arguments);
    };


    // _/_/_/_/_/_/_/_/_/_/_/
    // _/ Line
    // _/_/_/_/_/_/_/_/_/_/_/
    this.line=function(crd1,crd2,Cmd,objID)
    {
        var crdList = new Array();
        if (!crd1.z) crd1.z=0;
        if (!crd2.z) crd2.z=0;
        crdList.push(crd1,crd2);
        return this.trajectory(crdList,1,Cmd,objID);
    };

    // _/_/_/_/_/_/_/_/_/_/_/
    // _/ Regular Polygon
    // _/_/_/_/_/_/_/_/_/_/_/
       this.regularpolygon=function(crd,radius,npoint,objID)
    {
        var tetha=(2*Math.PI)/npoint;
        var crdList = new Array();
        if((""+radius).indexOf("px")!=-1){
            //alerJ(parseInt(radius)+ " / " + this.scaleSize(parseInt(radius)),this.getCurrentFromArray( this.matrixArray ));
            radius=this.scaleSize(parseInt(radius));
        }

        for (var p=0;p<npoint;p++)
            {
            tethanew=tetha*p+tetha/2;
            var point={"x":crd.x+radius*Math.cos(tethanew),"y":crd.y+radius*Math.sin(tethanew)};
            crdList.push(point);
            }
        this.trajectory(crdList,1,"L",objID);
        return crdList;
    };


    // _/_/_/_/_/_/_/_/_/_/_/
       // _/Regular Star
    // _/_/_/_/_/_/_/_/_/_/_/

    this.regularstar=function(crd,radius,npoint,objID)
    {
        var obj=0;
        var tetha = (2 * Math.PI) / npoint;
        var crdList = new Array();
        var odd = new Array();
        var even = new Array();
        if (("" + radius).indexOf("px") != -1) {
            // alerJ(parseInt(radius)+ " / " +
            // this.scaleSize(parseInt(radius)),this.getCurrentFromArray(
            // this.matrixArray ));
            radius = this.scaleSize(parseInt(radius));
        }
        for ( var p = 0; p < npoint; p++) {
            var tethanew = tetha * p;
            var point = new Object();
            point.x = crd.x + radius * Math.cos(tethanew);
            point.y = crd.y + radius * Math.sin(tethanew);
            if (p % 2 == 0) {
                odd.push(point);
            } else {
                even.push(point);
            }
        }
        if (npoint % 2 == 0) {
            this.trajectory(odd, 1);
            obj=this.trajectory(even, 1,"L",objID);
        } else {
            crdList = odd.concat(even);
            // alerJ('crdListStar',crdList)
            obj=this.trajectory(crdList, 1,"L",objID);
        }
        return obj;
    };


     // _/_/_/_/_/_/_/_/_/_/_/
    // _/ Ellipse with rotation
    // _/_/_/_/_/_/_/_/_/_/_/
    this.ellipse = function(crd, shortRadius, longRadius, rotationDegree,objID) {
        if (!rotationDegree)
            rotationDegree = 0;
        var npoint = 1000;
        var tetha = (2 * Math.PI) / npoint;
        var crdList = new Array();
        var alpha = (rotationDegree * Math.PI) / (180);
        for ( var p = 0; p < npoint; p++) {
            tethanew = tetha * p;
            var oldx = shortRadius * Math.cos(tethanew);
            var oldy = longRadius * Math.sin(tethanew);
            var point = {
                "x" : crd.x + (oldx) * Math.cos(alpha) - oldy * Math.sin(alpha),
                "y" : crd.y + oldy * Math.cos(alpha) + oldx * Math.sin(alpha)
            };
            crdList.push(point);
        }
        return this.trajectory(crdList, 1,"L",objID);
    };

     // _/_/_/_/_/_/_/_/_/_/_/
    // _/ Arc with rotation
    // _/_/_/_/_/_/_/_/_/_/_/
    this.arc=function(crd, startAngle, endAngle  , rx ,ry, rotation, howToClose,objID  )
    {
        var obj=0;
        startAngle = (startAngle*2*Math.PI)/(360);
        endAngle = (endAngle*2*Math.PI)/(360);
        if(("" + rx).indexOf("px")!=-1){
            //alerJ(parseInt(radius)+ " / " + this.scaleSize(parseInt(radius)),this.getCurrentFromArray( this.matrixArray ));
            rx=this.scaleSize(parseInt(rx));
        }
        if(("" + ry).indexOf("px")!=-1){
            //alerJ(parseInt(radius)+ " / " + this.scaleSize(parseInt(radius)),this.getCurrentFromArray( this.matrixArray ));
            ry=this.scaleSize(parseInt(ry));
        }

        var pointbegin1={"x":crd.x,"y":crd.y};
        if (!rotation) rotation=0;
        var alpha = (rotation*2*Math.PI)/(360);
        var crdList = new Array();
        crdList.push(pointbegin1);
        var noPoints = 100;
        for (var p=0;p<=noPoints;p++){
            var epsilon = p*(endAngle-startAngle)/noPoints;
            var oldx=rx*Math.cos(startAngle+epsilon);
            var oldy=ry*Math.sin(startAngle+epsilon);
            var pointbegin={"x":crd.x+oldx*Math.cos(alpha)- oldy*Math.sin(alpha),"y":crd.y+oldy*Math.cos(alpha)+oldx*Math.sin(alpha)};
            crdList.push(pointbegin);
        }
        if (howToClose=='segment') {
            obj=this.trajectory(crdList,1,"L",objID);
        }
        else if (howToClose=='open'){
            crdList.shift(pointbegin1);
            obj=this.trajectory(crdList,0,"L",objID);
        }
        else if (howToClose=='closed'){
            crdList.shift(pointbegin1);
            obj=this.trajectory(crdList,1,"L",objID);
        }
        return obj;
    };

    this.circle = function(crd, r, objID)
    {
        if(("" + r).indexOf("px")!=-1){
            r = vjSVGRoundPixel(this.scaleSize(parseInt(rx)));
        }

        return this.createObjWithDefaultAttributes('circle', arguments);
    };


    // _/_/_/_/_/_/_/_/_/_/_/_/
    // _/
    // _/ Set the default elements into Stack of Attributes and Matrixes
    // _/
    // _/_/_/_/_/_/_/_/_/_/_/_/

    this.setBrush (DefaultBrush, true);
    this.setPen(DefaultPen, true);
    this.setFont(DefaultFont, true); //weight:bold / style:italic
    this.sizeXYZ=DefaultsizeXYZ;

    // unitary matrix ... etc
    /*vjUnitMatrix  = new Array      ( [1, 0 , 0 , 0] ,
                                     [0, 1 , 0 , 0] ,
                                     [0, 0 , 1 , 0] ,
                                     [0, 0 , 0 , 1] );
                                     */
    //this.pushArray(this.matrixArray, vjUnitMatrix );
    this.is3d = (model=='3d') ? true  : false  ; // can be 2d or 3d

    this.symbolCoordinates=new Object();
    this.symbolCoordinates['star']=[{mode:'regularstar', n:5, size:"10px"}];
    this.symbolCoordinates['circle']=[{mode:'circle'}];
    this.symbolCoordinates['rectangle']=[{mode:'regularpolygon', npoint:4, size:"10px"}];
    this.symbolCoordinates['plus']=[{mode:'line', crd1:{x:-0.5, y:0}, crd2:{x:0.5, y:0}, size:"10px"},
                                    {mode:'line', crd1:{x:0, y:-0.5}, crd2:{x:0, y:0.5}, size:"10px"}];
    this.symbolCoordinates['box-minus']=[{mode:'regularpolygon', npoint:4, size:"10px"},
                                         {mode:'line', crd1:{x:-0.5, y:0}, crd2:{x:0.5, y:0}, size:"10px"}];
    this.symbolCoordinates['box-plus']=[{mode:'regularpolygon', npoint:4, size:"10px"},
                                        {mode:'line', crd1:{x:-0.5, y:0}, crd2:{x:0.5, y:0}, size:"10px"},
                                        {mode:'line', crd1:{x:0, y:-0.5}, crd2:{x:0, y:0.5}, size:"10px"}];
    this.symbolCoordinates['arrowhead']=[{mode:'closed-trajectory', coordinates:[{x:0,y:-0.3}, {x:0.4,y:-0.5}, {x:0,y:0.5}, {x:-0.4,y:-0.5}]}];

    this.symbol=function(definition,crd,_size,objID,isUnscaled)
    {
        this.setAspectPreservingMatrix(crd, false, isUnscaled);

        var g = null;
        if (this.symbolCoordinates[definition].length > 1) {
            // If we have a compound symbol, append its parts to a <g> group
            g = this.group();
            var old_svg = this.curGroupNode;
            this.curGroupNode = g;
        }

        for (var i=0; i<this.symbolCoordinates[definition].length; i++) {
            var librarySymbol=this.symbolCoordinates[definition][i];

            var size = _size ? _size : librarySymbol.size;
            if (librarySymbol.mode=='regularstar') {
                var npoint=librarySymbol.n;
                //alerJ("crdSTAR",crd)
                this.regularstar(crd,size,npoint,objID);
            }

            else if(librarySymbol.mode=='arc') {
                this.arc(crd, librarySymbol.startAngle, librarySymbol.endAngle , size ,size, librarySymbol.rotation, librarySymbol.howToClose,objID);
            }

            else if(librarySymbol.mode=='circle') {
                this.circle(crd, size, objID);
            }

            else if(librarySymbol.mode=='regularpolygon') {
                //alerJ("crd",crd)
                this.regularpolygon(crd, size, librarySymbol.npoint,objID);
            }

            else if(librarySymbol.mode=='line') {
                this.line({x: crd.x + librarySymbol.crd1.x * size, y: crd.y + librarySymbol.crd1.y * size}, {x: crd.x + librarySymbol.crd2.x * size, y: crd.y + librarySymbol.crd2.y * size}, undefined, objID);
            }

            else if(librarySymbol.mode=='closed-trajectory') {
                var coordinates = [];
                for (var ic=0; ic<librarySymbol.coordinates.length; ic++) {
                    coordinates.push({
                        x: crd.x + librarySymbol.coordinates[ic].x * size,
                        y: crd.y + librarySymbol.coordinates[ic].y * size
                    });
                }
                this.trajectory(coordinates, true, undefined, objID);
            }
            /*else {
                var localCrds = new Array();
                for ( var ic=0; ic< librarySymbol.coordinates.length; ++ic) {
                    localCrds[ic].x=parseInt(librarySymbol.coordinates[ic].*size/100);
                    localCrds[ic].y=parseInt(librarySymbol.coordinates[ic].*size/100);
                    localCrds[ic].z=parseInt(librarySymbol.coordinates[ic].*size/100);
                }
                this.trajectory(localCrds,librarySymbol.closed, librarySymbol.lineCmd)
            }*/
        }

        // If we are returning a compound symbol in a <g> group, we need to restore obj
        // and svg fields to their values after this.group() was called
        if (g) {
            this.obj = g;
            this.curGroupNode = old_svg;
        }

        this.popMatrix();
        return this.obj;
    };
};


