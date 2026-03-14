package com.demo.dtcc.model;

import java.util.List;

public class PositionsBulkResponse {
    private Integer count;
    private String generatedAt;
    private List<ObligationRecord> positions;

    public Integer getCount() { return count; }
    public void setCount(Integer count) { this.count = count; }
    public String getGeneratedAt() { return generatedAt; }
    public void setGeneratedAt(String generatedAt) { this.generatedAt = generatedAt; }
    public List<ObligationRecord> getPositions() { return positions; }
    public void setPositions(List<ObligationRecord> positions) { this.positions = positions; }
}
