import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ----- math on vector arrays -------------------------------------------------------------

function vecSetZero(a,anr) {
    anr *= 3;
    a[anr++] = 0.0;
    a[anr++] = 0.0;
    a[anr]   = 0.0;
}

function vecScale(a,anr, scale) {
    anr *= 3;
    a[anr++] *= scale;
    a[anr++] *= scale;
    a[anr]   *= scale;
}

function vecCopy(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    a[anr++] = b[bnr++]; 
    a[anr++] = b[bnr++]; 
    a[anr]   = b[bnr];
}

function vecAdd(a,anr, b,bnr, scale = 1.0) {
    anr *= 3; bnr *= 3;
    a[anr++] += b[bnr++] * scale; 
    a[anr++] += b[bnr++] * scale; 
    a[anr]   += b[bnr] * scale;
}

function vecSetDiff(dst,dnr, a,anr, b,bnr, scale = 1.0) {
    dnr *= 3; anr *= 3; bnr *= 3;
    dst[dnr++] = (a[anr++] - b[bnr++]) * scale;
    dst[dnr++] = (a[anr++] - b[bnr++]) * scale;
    dst[dnr]   = (a[anr] - b[bnr]) * scale;
}

function vecSetSum(dst,dnr, a,anr, b,bnr, scale = 1.0) {
    dnr *= 3; anr *= 3; bnr *= 3;
    dst[dnr++] = (a[anr++] + b[bnr++]) * scale;
    dst[dnr++] = (a[anr++] + b[bnr++]) * scale;
    dst[dnr]   = (a[anr] + b[bnr]) * scale;
}

function vecLengthSquared(a,anr) {
    anr *= 3;
    let a0 = a[anr], a1 = a[anr + 1], a2 = a[anr + 2];
    return a0 * a0 + a1 * a1 + a2 * a2;
}

function vecDistSquared(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    let a0 = a[anr] - b[bnr], a1 = a[anr + 1] - b[bnr + 1], a2 = a[anr + 2] - b[bnr + 2];
    return a0 * a0 + a1 * a1 + a2 * a2;
}	

function vecDot(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    return a[anr] * b[bnr] + a[anr + 1] * b[bnr + 1] + a[anr + 2] * b[bnr + 2];
}	

function vecSetCross(a,anr, b,bnr, c,cnr) {
    anr *= 3; bnr *= 3; cnr *= 3;
    a[anr++] = b[bnr + 1] * c[cnr + 2] - b[bnr + 2] * c[cnr + 1];
    a[anr++] = b[bnr + 2] * c[cnr + 0] - b[bnr + 0] * c[cnr + 2];
    a[anr]   = b[bnr + 0] * c[cnr + 1] - b[bnr + 1] * c[cnr + 0];
}			

var gThreeScene;
var gRenderer;
var gCamera;
var gCameraControl;
var gGrabber;
var gMouseDown = false;

// ------------------------------------------------------------------

var gPhysicsScene = 
{
    gravity : [0.0, -10.0, 0.0],
    dt : 1.0 / 60.0,
    numSubsteps : 10,
    paused: true,
    showEdges: false,
    cloth: null,				
};

// ------------------------------------------------------------------
function onShowEdges() 
{
    gPhysicsScene.showEdges = !gPhysicsScene.showEdges;
    for (var i = 0; i < gPhysicsScene.objects.length; i++) {
        gPhysicsScene.objects[i].edgeMesh.visible = gPhysicsScene.showEdges;
        gPhysicsScene.objects[i].triMesh.visible = !gPhysicsScene.showEdges;
    }
}			

// ------------------------------------------------------------------
function onCollision() 
{
    if (gPhysicsScene.cloth)
        gPhysicsScene.cloth.handleCollisions = !gPhysicsScene.cloth.handleCollisions;
}			

// ------------------------------------------------------------------
class Hash {
    constructor(spacing, maxNumObjects) 
    {
        this.spacing = spacing;
        this.tableSize = 5 * maxNumObjects;
        this.cellStart = new Int32Array(this.tableSize + 1);
        this.cellEntries = new Int32Array(maxNumObjects);
        this.queryIds = new Int32Array(maxNumObjects);
        this.querySize = 0;

        this.maxNumObjects = maxNumObjects;
        this.firstAdjId = new Int32Array(maxNumObjects + 1);
        this.adjIds = new Int32Array(10 * maxNumObjects);
    }

    hashCoords(xi, yi, zi) {
        var h = (xi * 92837111) ^ (yi * 689287499) ^ (zi * 283923481);	// fantasy function
        return Math.abs(h) % this.tableSize; 
    }

    intCoord(coord) {
        return Math.floor(coord / this.spacing);
    }

    hashPos(pos, nr) {
        return this.hashCoords(
            this.intCoord(pos[3 * nr]), 
            this.intCoord(pos[3 * nr + 1]),
            this.intCoord(pos[3 * nr + 2]));
    }

    create(pos) {
        var numObjects = Math.min(pos.length / 3, this.cellEntries.length);

        // determine cell sizes

        this.cellStart.fill(0);
        this.cellEntries.fill(0);

        for (var i = 0; i < numObjects; i++) {
            var h = this.hashPos(pos, i);
            this.cellStart[h]++;
        }

        // determine cells starts

        var start = 0;
        for (var i = 0; i < this.tableSize; i++) {
            start += this.cellStart[i];
            this.cellStart[i] = start;
        }
        this.cellStart[this.tableSize] = start;	// guard

        // fill in objects ids

        for (var i = 0; i < numObjects; i++) {
            var h = this.hashPos(pos, i);
            this.cellStart[h]--;
            this.cellEntries[this.cellStart[h]] = i;
        }
    }

    query(pos, nr, maxDist) {
        var x0 = this.intCoord(pos[3 * nr] - maxDist);
        var y0 = this.intCoord(pos[3 * nr + 1] - maxDist);
        var z0 = this.intCoord(pos[3 * nr + 2] - maxDist);

        var x1 = this.intCoord(pos[3 * nr] + maxDist);
        var y1 = this.intCoord(pos[3 * nr + 1] + maxDist);
        var z1 = this.intCoord(pos[3 * nr + 2] + maxDist);

        this.querySize = 0;

        for (var xi = x0; xi <= x1; xi++) {
            for (var yi = y0; yi <= y1; yi++) {
                for (var zi = z0; zi <= z1; zi++) {
                    var h = this.hashCoords(xi, yi, zi);
                    var start = this.cellStart[h];
                    var end = this.cellStart[h + 1];

                    for (var i = start; i < end; i++) {
                        this.queryIds[this.querySize] = this.cellEntries[i];
                        this.querySize++;
                    }
                }
            }
        }
    }

    queryAll(pos, maxDist) {

        var num = 0;
        var maxDist2 = maxDist * maxDist;

        for (var i = 0; i < this.maxNumObjects; i++) {
            var id0 = i;
            this.firstAdjId[id0] = num;
            this.query(pos, id0, maxDist);

            for (var j = 0; j < this.querySize; j++) {
                var id1 = this.queryIds[j];
                if (id1 >= id0)
                    continue;
                var dist2 = vecDistSquared(pos, id0, pos, id1);
                if (dist2 > maxDist2)
                    continue;
                
                if (num >= this.adjIds.length) {
                    var newIds = new Int32Array(2 * num);  // dynamic array
                    newIds.set(this.adjIds);
                    this.adjIds = newIds;
                }
                this.adjIds[num++] = id1;
            }
        }

        this.firstAdjId[this.maxNumObjects] = num;
    }
};

// ------------------------------------------------------------------
class Cloth {
    constructor(scene, numX, numY, spacing, thickness, bendingCompliance = 1.0)
    {
        // particles

        var jitter = 0.001 * spacing;

        this.numParticles = numX * numY;
        this.pos = new Float32Array(3 * this.numParticles);
        this.prevPos = new Float32Array(3 * this.numParticles);
        this.restPos = new Float32Array(3 * this.numParticles);
        this.vel = new Float32Array(3 * this.numParticles);
        this.invMass = new Float32Array(this.numParticles);
        this.thickness = thickness;
        this.handleCollisions = true;
        this.vecs = new Float32Array(4 * 3);

        // particles

        var attach = true;

        for (var i = 0; i < numX; i++) {
            for (var j = 0; j < numY; j++) {
                var id = i * numY + j;
                this.pos[3 * id] = - numX * spacing * 0.5 + i * spacing;
                this.pos[3 * id + 1] = 0.2 + j * spacing;
                this.pos[3 * id + 2] = 0.0;
                this.invMass[id] = 1.0;
                if (attach && j == numY - 1 && (i == 0 || i == numX - 1))
                    this.invMass[id] = 0.0;
            }
        }

        for (var i = 0; i < this.pos.length; i++) 
            this.pos[i] += -jitter * 2.0 * jitter * Math.random()

        this.hash = new Hash(spacing, this.numParticles);

        this.restPos.set(this.pos);
        this.vel.fill(0.0);

        // constraints

        var numConstraintTypes = 6;

        this.ids = new Int32Array(this.numParticles * numConstraintTypes * 2);
        this.compliances = new Float32Array(this.numParticles * numConstraintTypes);
        var offsets = [0,0, 0,1,  0,0, 1,0,  0,0, 1,1,  0,1, 1,0,  0,0, 0,2,  0,0, 2,0];
        var num = 0;

        var stretchCompliance = 0.0;
        var shearCompliance = 0.0001;

        var compliances = [stretchCompliance, stretchCompliance, shearCompliance, shearCompliance, bendingCompliance, bendingCompliance];

        // Iterate through each triangle to establish constraints based on the mesh connectivity
        for (var constType = 0; constType < numConstraintTypes; constType++) {
            for (var i = 0; i < numX; i++) {
                for (var j = 0; j < numY; j++) {
                    var p = 4 * constType;

                    var i0 = i + offsets[p];
                    var j0 = j + offsets[p + 1];
                    var i1 = i + offsets[p + 2];
                    var j1 = j + offsets[p + 3];
                    if (i0 < numX && j0 < numY && i1 < numX && j1 < numY) {
                        this.ids[num++] = i0 * numY + j0;
                        this.ids[num++] = i1 * numY + j1;
                        this.compliances[Math.floor(num / 2)] = compliances[constType];
                    }
                }
            }
        }

        // randomize

        this.numConstraints = Math.floor(num / 2);

        // for (var i = 0; i < this.numConstraints; i++) {
        // 	var j = i + Math.floor(Math.random() * (this.numConstraints - i));
        // 	var c = this.compliances[i]; this.compliances[i] = this.compliances[j]; this.compliances[j] = c;
        // 	var id = this.ids[2 * i]; this.ids[2 * i] = this.ids[2 * j]; this.ids[2 * j] = id;
        // 	id = this.ids[2 * i + 1]; this.ids[2 * i + 1] = this.ids[2 * j + 1]; this.ids[2 * j + 1] = id;
        // }

        // pre-compute rest lengths

        this.restLens = new Float32Array(this.numConstraints);
        for (var i = 0; i < this.numConstraints; i++) {
            var id0 = this.ids[2 * i];
            var id1 = this.ids[2 * i + 1];
            this.restLens[i] = Math.sqrt(vecDistSquared(this.pos,id0, this.pos,id1));
        }

        // visual meshes

        var triIds = [];
        var edgeIds = [];

        for (var i = 0; i < numX; i++) {
            for (var j = 0; j < numY; j++) {
                var id = i * numY + j;
                if (i < numX - 1 && j < numY - 1) {
                    triIds.push(id + 1); triIds.push(id); triIds.push(id + 1 + numY);
                    triIds.push(id + 1 + numY); triIds.push(id); triIds.push(id + numY);
                }
                if (i < numX - 1) {
                    edgeIds.push(id);
                    edgeIds.push(id + numY);
                }
                if (j < numY - 1) {
                    edgeIds.push(id);
                    edgeIds.push(id + 1);
                }
            }
        }					

        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        geometry.setIndex(triIds);
        var visMaterial = new THREE.MeshPhongMaterial({color: 0xff0000, side: THREE.FrontSide});
        this.triMesh = new THREE.Mesh(geometry, visMaterial);
        this.triMesh.castShadow = true;
        this.triMesh.userData = this;	// for raycasting
        this.triMesh.layers.enable(1);
        scene.add(this.triMesh);

        var backMaterial = new THREE.MeshPhongMaterial({color: 0xff8000, side: THREE.BackSide});
        this.backMesh = new THREE.Mesh(geometry, backMaterial);
        this.backMesh.userData = this;	// for raycasting
        this.backMesh.layers.enable(1);
        
        scene.add(this.backMesh);
        geometry.computeVertexNormals();

        // visual edge mesh

        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
        geometry.setIndex(edgeIds);
        var lineMaterial = new THREE.LineBasicMaterial({color: 0xff0000, linewidth: 2});
        this.edgeMesh = new THREE.LineSegments(geometry, lineMaterial);
        this.edgeMesh.visible = true;
        scene.add(this.edgeMesh);

        this.updateVisMeshes();
    }

    simulate(frameDt, numSubSteps, gravity)
    {
        var dt = frameDt / numSubSteps;
        var maxVelocity = 0.2 * this.thickness / dt;

        if (this.handleCollisions) {
            this.hash.create(this.pos);
            var maxTravelDist = maxVelocity * frameDt;
            this.hash.queryAll(this.pos, maxTravelDist);
        }
        
        for (var step = 0; step < numSubSteps; step++)  {

            // integrate 

            for (var i = 0; i < this.numParticles; i++) {
                if (this.invMass[i] > 0.0) {
                    vecAdd(this.vel,i, gravity,0, dt);
                    var v = Math.sqrt(vecLengthSquared(this.vel,i));
                    if (v > maxVelocity) {
                        vecScale(this.vel,i, maxVelocity / v);
                    }
                    vecCopy(this.prevPos,i, this.pos,i);
                    vecAdd(this.pos,i, this.vel,i, dt);
                }
            }

            // solve

            this.solveGroundCollisions();

            this.solveConstraints(dt);
            if (this.handleCollisions)
                 this.solveCollisions(dt);

            // update velocities

            for (var i = 0; i < this.numParticles; i++) {
                if (this.invMass[i] > 0.0)
                    vecSetDiff(this.vel,i, this.pos,i, this.prevPos,i, 1.0 / dt);
            }
        }

        this.updateVisMeshes();
    }
    
    solveConstraints(dt) {
        for (var i = 0; i < this.numConstraints; i++) {
            var id0 = this.ids[2 * i];
            var id1 = this.ids[2 * i + 1];
            var w0 = this.invMass[id0];
            var w1 = this.invMass[id1];
            var w = w0 + w1;
            if (w == 0.0)
                continue;

            vecSetDiff(this.vecs,0, this.pos,id0, this.pos,id1);
            var len = Math.sqrt(vecLengthSquared(this.vecs,0));
            if (len == 0.0)
                continue;
            vecScale(this.vecs,0, 1.0 / len);
            var restLen = this.restLens[i];
            var C = len - restLen;
            var alpha = this.compliances[i] / dt /dt;
            var s = -C / (w + alpha);
            vecAdd(this.pos,id0, this.vecs,0, s * w0);
            vecAdd(this.pos,id1, this.vecs,0, -s * w1);
        }
        var done = 0;
    }

    solveGroundCollisions() {
        for (var i = 0; i < this.numParticles; i++) {
            if (this.invMass[i] == 0.0)
                continue;
            var y = this.pos[3 * i + 1];
            if (y < 0.5 * this.thickness) {
                var damping = 1.0
                vecSetDiff(this.vecs,0, this.pos,i, this.prevPos,i);
                vecAdd(this.pos,i, this.vecs,0, -damping);
                this.pos[3 * i + 1] = 0.5 * this.thickness;
            }
        }
    }

    solveCollisions(dt) { 

        var thickness2 = this.thickness * this.thickness;

        for (var i = 0; i < this.numParticles; i++) {
            if (this.invMass[i] == 0.0)
                continue;
            var id0 = i;
            var first = this.hash.firstAdjId[i];
            var last = this.hash.firstAdjId[i + 1];

            for (var j = first; j < last; j++) {

                var id1 = this.hash.adjIds[j];
                if (this.invMass[id1] == 0.0)
                    continue;

                vecSetDiff(this.vecs,0, this.pos,id1, this.pos,id0);

                var dist2 = vecLengthSquared(this.vecs,0);
                if (dist2 > thickness2 || dist2 == 0.0)
                    continue;
                var restDist2 = vecDistSquared(this.restPos,id0, this.restPos,id1);

                var minDist = this.thickness;
                if (dist2 > restDist2)
                    continue;
                if (restDist2 < thickness2)
                    minDist = Math.sqrt(restDist2);

                // position correction
                var dist = Math.sqrt(dist2);
                vecScale(this.vecs,0, (minDist - dist) / dist);
                vecAdd(this.pos,id0, this.vecs,0, -0.5);
                vecAdd(this.pos,id1, this.vecs,0,  0.5);

                // velocities
                vecSetDiff(this.vecs,0, this.pos,id0, this.prevPos, id0);
                vecSetDiff(this.vecs,1, this.pos,id1, this.prevPos, id1);

                // average velocity
                vecSetSum(this.vecs,2, this.vecs,0, this.vecs,1, 0.5);

                // velocity corrections
                vecSetDiff(this.vecs,0, this.vecs,2, this.vecs,0);
                vecSetDiff(this.vecs,1, this.vecs,2, this.vecs,1);
                
                // add corrections
                var friction = 0.0;
                vecAdd(this.pos,id0, this.vecs,0, friction);
                vecAdd(this.pos,id1, this.vecs,1, friction);
            }
        }
    }
    
    updateVisMeshes() {
        this.triMesh.geometry.computeVertexNormals();
        this.triMesh.geometry.attributes.position.needsUpdate = true;
        this.triMesh.geometry.computeBoundingSphere();

        this.edgeMesh.geometry.attributes.position.needsUpdate = true;
    }

    startGrab(pos) 
    {
        var p = [pos.x, pos.y, pos.z];
        var minD2 = Number.MAX_VALUE;
        this.grabId = -1;
        for (let i = 0; i < this.numParticles; i++) {
            var d2 = vecDistSquared(p,0, this.pos,i);
            if (d2 < minD2) {
                minD2 = d2;
                this.grabId = i;
            }
        }

        if (this.grabId >= 0) {
            this.grabInvMass = this.invMass[this.grabId];
            this.invMass[this.grabId] = 0.0;
            vecCopy(this.pos,this.grabId, p,0);	
        }
    }

    moveGrabbed(pos, vel) 
    {
        if (this.grabId >= 0) {
            var p = [pos.x, pos.y, pos.z];
            vecCopy(this.pos,this.grabId, p,0);
        }
    }

    endGrab(pos, vel) 
    {
        if (this.grabId >= 0) {
            this.invMass[this.grabId] = this.grabInvMass;
            var v = [vel.x, vel.y, vel.z];
            vecCopy(this.vel,this.grabId, v,0);
        }
        this.grabId = -1;
    }								
}

var timeFrames = 0;
var timeSum = 0;	

// ------------------------------------------------------------------
function simulate() 
{
    if (gPhysicsScene.paused)
        return;

    var startTime = performance.now();

    gPhysicsScene.cloth.simulate(gPhysicsScene.dt, gPhysicsScene.numSubsteps, gPhysicsScene.gravity);

    gGrabber.increaseTime(gPhysicsScene.dt);

    var endTime = performance.now();
    timeSum += endTime - startTime; 
    timeFrames++;

    if (timeFrames > 10) {
        timeSum /= timeFrames;
        document.getElementById("ms").innerHTML = timeSum.toFixed(3);		
        timeFrames = 0;
        timeSum = 0;
    }					
}

// ------------------------------------------
        
function initThreeScene() 
{
    gThreeScene = new THREE.Scene();
    
    // Lights
    
    gThreeScene.add( new THREE.AmbientLight( 0xffffff ) );	
    // gThreeScene.fog = new THREE.Fog( 0x000000, 0, 15 );				

    var spotLight = new THREE.SpotLight( 0xffffff );
    spotLight.angle = Math.PI / 5;
    spotLight.penumbra = 0.2;
    spotLight.position.set( 2, 3, 3 );
    spotLight.castShadow = true;
    spotLight.shadow.camera.near = 3;
    spotLight.shadow.camera.far = 10;
    spotLight.shadow.mapSize.width = 1024;
    spotLight.shadow.mapSize.height = 1024;
    gThreeScene.add( spotLight );

    var dirLight = new THREE.DirectionalLight( 0x55505a, 1 );
    dirLight.position.set( 0, 3, 0 );
    dirLight.castShadow = true;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 10;

    dirLight.shadow.camera.right = 1;
    dirLight.shadow.camera.left = - 1;
    dirLight.shadow.camera.top	= 1;
    dirLight.shadow.camera.bottom = - 1;

    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    gThreeScene.add( dirLight );
    
    // Geometry

    var ground = new THREE.Mesh(
        new THREE.BufferGeometry( 20, 20, 1, 1 ),
        new THREE.MeshPhongMaterial( { color: 0xa0adaf, shininess: 150 } )
    );				

    ground.rotation.x = - Math.PI / 2; // rotates X/Y to X/Z
    ground.receiveShadow = true;
    gThreeScene.add( ground );
    
    var helper = new THREE.GridHelper( 20, 20 );
    helper.material.opacity = 1.0;
    helper.material.transparent = true;
    helper.position.set(0, 0.002, 0);
    gThreeScene.add( helper );				
    
    // Renderer

    gRenderer = new THREE.WebGLRenderer();
    gRenderer.shadowMap.enabled = true;
    gRenderer.setPixelRatio( window.devicePixelRatio );
    gRenderer.setSize( 0.8 * window.innerWidth, 0.8 * window.innerHeight );
    window.addEventListener( 'resize', onWindowResize, false );
    container.appendChild( gRenderer.domElement );
    
    // Camera
            
    gCamera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.01, 100);
    gCamera.position.set(0, 0.3, 0.5);
    gCamera.updateMatrixWorld();	

    gThreeScene.add(gCamera);

    gCameraControl = new OrbitControls(gCamera, gRenderer.domElement);
    gCameraControl.zoomSpeed = 0.8;
    gCameraControl.panSpeed = 0.4;
    gCameraControl
    gCameraControl.target = new THREE.Vector3(0.0, 0.1, 0.0);
    gCameraControl.update();

    // grabber

    gGrabber = new Grabber();
    container.addEventListener( 'pointerdown', onPointer, false );
    container.addEventListener( 'pointermove', onPointer, false );
    container.addEventListener( 'pointerup', onPointer, false );
}

function initPhysics(triIds) 
{
    var spacing = 0.01;
    var thickness = 0.01;
    var numX = 30;
    var numY = 200;

    gPhysicsScene.cloth = new Cloth(gThreeScene, numX, numY, spacing, thickness);
    document.getElementById("numTris").innerHTML = numX * numY * 2;
    document.getElementById("numVerts").innerHTML = numX * numY;
}

// ------- grabber -----------------------------------------------------------

class Grabber {
    constructor() {
        this.raycaster = new THREE.Raycaster();
        this.raycaster.layers.set(1);
        this.raycaster.params.Line.threshold = 0.1;
        this.physicsObject = null;
        this.distance = 0.0;
        this.prevPos = new THREE.Vector3();
        this.vel = new THREE.Vector3();
        this.time = 0.0;
    }
    increaseTime(dt) {
        this.time += dt;
    }
    updateRaycaster(x, y) {
        var rect = gRenderer.domElement.getBoundingClientRect();
        this.mousePos = new THREE.Vector2();
        this.mousePos.x = ((x - rect.left) / rect.width ) * 2 - 1;
        this.mousePos.y = -((y - rect.top) / rect.height ) * 2 + 1;
        this.raycaster.setFromCamera( this.mousePos, gCamera );
    }
    start(x, y) {
        this.physicsObject = null;
        this.updateRaycaster(x, y);
        var intersects = this.raycaster.intersectObjects( gThreeScene.children );
        if (intersects.length > 0) {
            var obj = intersects[0].object.userData;
            if (obj) {
                this.physicsObject = obj;
                this.distance = intersects[0].distance;
                var pos = this.raycaster.ray.origin.clone();
                pos.addScaledVector(this.raycaster.ray.direction, this.distance);
                this.physicsObject.startGrab(pos);
                this.prevPos.copy(pos);
                this.vel.set(0.0, 0.0, 0.0);
                this.time = 0.0;
                if (gPhysicsScene.paused)
                    run();
            }
        }
    }
    move(x, y) {
        if (this.physicsObject) {
            this.updateRaycaster(x, y);
            var pos = this.raycaster.ray.origin.clone();
            pos.addScaledVector(this.raycaster.ray.direction, this.distance);

            this.vel.copy(pos);
            this.vel.sub(this.prevPos);
            if (this.time > 0.0)
                this.vel.divideScalar(this.time);
            else
                this.vel.set(0.0, 0.0, 0.0);
            this.prevPos.copy(pos);
            this.time = 0.0;

            this.physicsObject.moveGrabbed(pos, this.vel);
        }
    }
    end(x, y) {
        if (this.physicsObject) { 
            this.physicsObject.endGrab(this.prevPos, this.vel);
            this.physicsObject = null;
        }
    }
}			

function onPointer( evt ) 
{
    event.preventDefault();
    if (evt.type == "pointerdown") {
        gGrabber.start(evt.clientX, evt.clientY);
        gMouseDown = true;
        if (gGrabber.physicsObject) {
            gCameraControl.saveState();
            gCameraControl.enabled = false;
        }
    }
    else if (evt.type == "pointermove" && gMouseDown) {
        gGrabber.move(evt.clientX, evt.clientY);
    }
    else if (evt.type == "pointerup") {
        if (gGrabber.physicsObject) {
            gGrabber.end();
            gCameraControl.reset();
        }
        gMouseDown = false;
        gCameraControl.enabled = true;
    }
}	

document.getElementById("bendingComplianceSlider").oninput = function() {
    for (var i = 0; i < gPhysicsScene.objects.length; i++) 
        gPhysicsScene.objects[i].bendingCompliance = this.value;
}

// ------------------------------------------------------

function onWindowResize() {

    gCamera.aspect = window.innerWidth / window.innerHeight;
    gCamera.updateProjectionMatrix();
    gRenderer.setSize( window.innerWidth, window.innerHeight );
}

function run() {
    var button = document.getElementById('buttonRun');
    if (gPhysicsScene.paused)
        button.innerHTML = "Stop";
    else
        button.innerHTML = "Run";
    gPhysicsScene.paused = !gPhysicsScene.paused;
}

function restart() {
    location.reload();
}

// buttons --------------------------------------------------------------
document.getElementById('checkboxEdges').addEventListener('click', function() {
    onShowEdges();
});

document.getElementById('checkboxCollisions').addEventListener('click', function() {
    onCollision();
});

document.getElementById("buttonRestart").addEventListener('click', function() {
    restart();
})

document.getElementById("buttonRun").addEventListener('click', function() {
    run();
})

// make browser to call us repeatedly -----------------------------------

function update() {
    simulate();
    gRenderer.render(gThreeScene, gCamera);
    requestAnimationFrame(update);
}
        
initThreeScene();
onWindowResize();
initPhysics();
update();