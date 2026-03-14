package com.demo.dtcc.controller;

import com.demo.dtcc.model.AccountNetFlowResponse;
import com.demo.dtcc.model.DtccOutstandingResponse;
import com.demo.dtcc.model.DtccSummaryResponse;
import com.demo.dtcc.model.ObligationRecord;
import com.demo.dtcc.model.ObligationSearchRequest;
import com.demo.dtcc.model.PositionsBulkResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/dtcc/intraday")
public class DtccIntradayController {

    @GetMapping("/summary")
    public ResponseEntity<DtccSummaryResponse> getSummary(@RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/obligations")
    public ResponseEntity<List<ObligationRecord>> listObligations(
            @RequestParam(required = false) String currency,
            @RequestParam(required = false) String accountId,
            @RequestParam(required = false) String issuerId,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(List.of());
    }

    @PostMapping("/obligations/search")
    public ResponseEntity<List<ObligationRecord>> searchObligations(@RequestBody(required = false) ObligationSearchRequest request) {
        return ResponseEntity.ok(List.of());
    }

    @GetMapping("/outstanding")
    public ResponseEntity<DtccOutstandingResponse> getOutstanding(@RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/positions/bulk")
    public ResponseEntity<PositionsBulkResponse> getBulkPositions(@RequestParam(required = false) Integer count) {
        return ResponseEntity.ok(null);
    }

    @GetMapping("/accounts/{accountId}/net-flow")
    public ResponseEntity<AccountNetFlowResponse> getAccountNetFlow(
            @PathVariable String accountId,
            @RequestParam(required = false) String currency) {
        return ResponseEntity.ok(null);
    }
}
